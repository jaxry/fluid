
(function() {

'use strict';
main();

var gl, canvas, programs, framebuffers, vertexHandler, input, constants, params;

function main() {
    init();
    initGui();
    animate();
}

function init() {
    framebuffers = {
        velocity: null,
        pressure: null,
        divergence: null
    };
    programs = {
        fluidSim: null,
        addForce: null,
        screen: null
    };
    constants = {
        pixelX: null,
        pixelY: null,
        aspectRatio: null,
        gridScale: null,
        attribs: {
            'a_position': 0,
            'a_offset': 1
        }
    };
    params = {
        resolution: 450,
        resolutionScale: null,
        iterations: 40,
        viscosity: null,
        pressure: null,
        c1: [100, 0, 255],
        c2: [100, 255, 255],
        c3: [100, 0, 0],
        c4: [100, 255, 0],
        c5: [200, 0, 0],
        
        setResolution: function() {
            this.resolutionScale = this.resolution / Math.max(window.innerWidth, window.innerHeight);
        }
    };

    canvas =  document.getElementById('canvas');
    gl = canvas.getContext('webgl', {
        alpha: false,
        depth: false,
        stencil: false
    });

    if (!gl){
        alert('Your browser does not support WebGL.');
    }

    if (!gl.getExtension('OES_texture_float') || !gl.getExtension('OES_texture_float_linear')) {
        alert('Your browser does not support floating point textures.');
    }

    window.onresize = function() {
        params.setResolution();
        canvas.width = window.innerWidth * params.resolutionScale;
        canvas.height = window.innerHeight * params.resolutionScale;

        gl.viewport(0, 0, canvas.width, canvas.height);

        constants.pixelX = 1 / canvas.width;
        constants.pixelY = 1 / canvas.height;
        constants.gridScale = Math.sqrt(canvas.width * canvas.height);
        constants.aspectRatio = canvas.width / canvas.height;

        vertexHandler = makeVertexHandler();

        framebuffers.velocity = makeFbo(gl, canvas.width, canvas.height, {backbuffer: true, format: gl.RGB, type: gl.FLOAT});
        framebuffers.pressure = makeFbo(gl, canvas.width, canvas.height, {backbuffer: true, format: gl.RGB, type: gl.FLOAT});
        framebuffers.divergence = makeFbo(gl, canvas.width, canvas.height, {format: gl.RGB, type: gl.FLOAT});
    };
    window.onresize();
    
    input = makeInputHandler();
    programs.fluidSim = makeFluidSimProgram();
    programs.screen = makeScreenProgram();

    window.onmousemove = function(e) {
        input.compute(e.clientX, e.clientY, window.innerWidth, window.innerHeight);
        programs.fluidSim.addForce();
    };
}

function animate() {
    programs.fluidSim.draw();
    programs.screen.draw();
    input.smooth();
    window.requestAnimationFrame(animate);
}

function makeInputHandler() {
    var smoothing = 5;

    var check,
        x0, y0,
        t0 = Date.now(),
        dx0 = new Array(smoothing),
        dy0 = new Array(smoothing),
        speed0 = new Array(smoothing);
        for (var i = 0; i < smoothing; i++) {
            dx0[i] = dy0[i] = speed0[i] = 0;
        }

    function smoothArray(obj, member, array) {
        for (var i = 0; i < smoothing; i++) {
            obj[member] += array[i];
        }
        input[member] /= smoothing + 1;
        for (var i = 0; i < smoothing-1; i++){
            array[i] = array[i+1];
        }
        array[smoothing-1] = obj[member];
    }

    return {
        mouseX: 0,
        mouseY: 0,
        mouseDx: 0,
        mouseDy: 0,
        speed: 0,
        compute: function(clientX, clientY, width, height) {

            this.mouseX = clientX / width;
            this.mouseY = 1 - clientY / height;
            this.mouseDx = (clientX - x0) || 0;
            this.mouseDy = (y0 - clientY) || 0;

            var time = Date.now();
            this.speed = Math.sqrt(this.mouseDx * this.mouseDx + this.mouseDy * this.mouseDy) / Math.max(time - t0, Number.MIN_VALUE);
            this.speed = Math.min(this.speed, 3) / Math.max(width, height);

            smoothArray(this, 'mouseDx', dx0);
            smoothArray(this, 'mouseDy', dy0);
            smoothArray(this, 'speed', speed0);

            x0 = clientX;
            y0 = clientY;
            t0 = time;
            check = true;
        },
        smooth: function() {
            if (check && Date.now() - t0 > 75) {
                for (var i = 0; i < smoothing; i++) {
                    dx0[i] = dy0[i] = speed0[i] = 0;
                }
                check = false;
            }
        }
    };
}

function makeVertexHandler() {

    gl.enableVertexAttribArray(constants.attribs.a_position);

    var interior = gl.createBuffer(),
        boundary = gl.createBuffer(),
        closure = gl.createBuffer(),
        offset = gl.createBuffer();

    var x = constants.pixelX,
        y = constants.pixelY;

    gl.bindBuffer(gl.ARRAY_BUFFER, closure);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        0, 0,
        0, 1,
        1, 1,
        1, 0]), gl.STATIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, interior);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        0 + x, 0 + y,
        0 + x, 1 - y,
        1 - x, 1 - y,
        1 - x, 0 + y]), gl.STATIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, boundary);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        x, y, x, 1,
        x, 1, 1, 1,
        1, 1, 1, y,
        1, y, x, y]), gl.STATIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, offset);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
         x,  0,  x,  0,
         0, -y,  0, -y,
        -x,  0, -x,  0,
         0,  y,  0,  y]), gl.STATIC_DRAW);
    gl.vertexAttribPointer(constants.attribs.a_offset, 2, gl.FLOAT, false, 0, 0);
    
    return {
        drawClosure: function() {
            gl.bindBuffer(gl.ARRAY_BUFFER, closure);
            gl.vertexAttribPointer(constants.attribs.a_position, 2, gl.FLOAT, false, 0, 0);
            gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
        },

        drawInterior: function() {
            gl.bindBuffer(gl.ARRAY_BUFFER, interior);
            gl.vertexAttribPointer(constants.attribs.a_position, 2, gl.FLOAT, false, 0, 0);
            gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
        },

        drawBoundary: function() {
            gl.enableVertexAttribArray(constants.attribs.a_offset);
            gl.bindBuffer(gl.ARRAY_BUFFER, boundary);
            gl.vertexAttribPointer(constants.attribs.a_position, 2, gl.FLOAT, false, 0, 0);
            gl.drawArrays(gl.LINES, 0, 8);
            gl.disableVertexAttribArray(constants.attribs.a_offset);
        }
    };
}

function makeFluidSimProgram() {

    var pAddForce    = makeProgram(gl, 'vertex-shader', 'add-force-shader',
                                   {uniforms: ['u_mouse', 'u_mouseDelta', 'u_speed', 'u_resolution', 'u_gridScale', 'u_mouseStrength']}),
        
        pAdvect      = makeProgram(gl, 'vertex-shader', 'advect-shader',
                                   {uniforms: ['u_aspectRatio', 'u_gridScale', 'u_viscosity']}),

        pDiffuse     = makeProgram(gl, 'vertex-shader', 'diffuse-shader',
                                   {uniforms: ['u_onePixel', 'u_gridScale']}),

        pDivergence  = makeProgram(gl, 'vertex-shader', 'divergence-shader',
                                   {uniforms: ['u_onePixel', 'u_gridScale']}),
        
        pPressure    = makeProgram(gl, 'vertex-shader', 'conserve-pressure-shader' ,
                                   {uniforms: ['u_scale']}),
    
        pJacobi      = makeProgram(gl, 'vertex-shader', 'poisson-jacobi-shader',
                                   {uniforms: ['u_onePixel', 'u_gridScale', 'u_divergence']}),

        pSubtraction = makeProgram(gl, 'vertex-shader', 'gradient-subtract-shader',
                                   {uniforms: ['u_onePixel', 'u_gridScale', 'u_pressure']}),
        
        pBoundary    = makeProgram(gl, 'vertex-shader', 'boundary-condition-shader',
                                   {uniforms: ['u_scale']});

    var addForceCheck = false;

    function drawBoundary(scale) {
        gl.useProgram(pBoundary);
        gl.uniform1f(pBoundary.u_scale, scale);
        vertexHandler.drawBoundary();
    }

    return {
        draw: function() {

            // diffuse
            // gl.useProgram(pDiffuse);
            // gl.uniform2f(pDiffuse.u_onePixel, constants.pixelX, constants.pixelY);
            // gl.uniform1f(pDiffuse.u_gridScale, constants.gridScale);
            // for (var i = 0; i < 20; i++) {
            //     gl.useProgram(pDiffuse);
            //     framebuffers.velocity.use();
            //     vertexHandler.drawInterior();
            //     drawBoundary(-1);
            // }

            // advect
            gl.useProgram(pAdvect);
            gl.uniform1f(pAdvect.u_gridScale, constants.gridScale);
            gl.uniform2f(pAdvect.u_aspectRatio, 1, constants.aspectRatio);
            gl.uniform1f(pAdvect.u_viscosity, params.viscosity);
            framebuffers.velocity.use();
            vertexHandler.drawInterior();
            drawBoundary(-1);

            // add force
            if (addForceCheck) {
                gl.useProgram(pAddForce);
                gl.uniform2f(pAddForce.u_mouse, input.mouseX, input.mouseY);
                gl.uniform2f(pAddForce.u_mouseDelta, input.mouseDx, input.mouseDy);
                gl.uniform1f(pAddForce.u_speed, input.speed);
                gl.uniform1f(pAddForce.u_gridScale, params.resolution);
                gl.uniform2f(pAddForce.u_resolution, canvas.width, canvas.height);
                framebuffers.velocity.use();
                vertexHandler.drawInterior();
                addForceCheck = false;
            }

            // project
            gl.useProgram(pDivergence);
            gl.uniform2f(pDivergence.u_onePixel, constants.pixelX, constants.pixelY);
            gl.uniform1f(pDivergence.u_gridScale, constants.gridScale);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, framebuffers.velocity.texture);
            framebuffers.divergence.use();
            vertexHandler.drawInterior();
            drawBoundary(1);

            gl.useProgram(pPressure);
            gl.uniform1f(pPressure.u_scale, params.pressure);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, framebuffers.pressure.texture);
            framebuffers.pressure.use();
            vertexHandler.drawClosure();

            gl.useProgram(pJacobi);
            gl.uniform2f(pJacobi.u_onePixel, constants.pixelX, constants.pixelY);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, framebuffers.divergence.texture);
            gl.uniform1i(pJacobi.u_divergence, 1);
            for (var i = 0; i < params.iterations; i++) {
                gl.useProgram(pJacobi);
                framebuffers.pressure.use();
                vertexHandler.drawInterior();
                drawBoundary(1);
            }

            gl.useProgram(pSubtraction);
            gl.uniform2f(pSubtraction.u_onePixel, constants.pixelX, constants.pixelY);
            gl.uniform1f(pSubtraction.u_gridScale, constants.gridScale);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, framebuffers.pressure.texture);
            gl.uniform1i(pSubtraction.u_pressure, 1);
            framebuffers.velocity.use();
            vertexHandler.drawInterior();
            drawBoundary(-1);
        },

        addForce: function() {
            addForceCheck = true;
        }
    };
}

function makeScreenProgram() {
    var program = makeProgram(gl, 'vertex-shader', 'screen-shader',
                              {uniforms: ['u_c1', 'u_c2', 'u_c3', 'u_c4', 'u_c5', 'u_gridScale', 'u_pressure', 'u_background']});

    function setColors() {
        var norm = {};
        for (var i = 1; i <= 5; i++) {
            norm[i] = new Array(3);
            for (var j = 0; j < 3; j++) {
                norm[i][j] = params['c' + i][j] / 255;
            }
        }

        gl.useProgram(program);
        gl.uniform3fv(program.u_c1, norm[1]);
        gl.uniform3fv(program.u_c2, norm[2]);
        gl.uniform3fv(program.u_c3, norm[3]);
        gl.uniform3fv(program.u_c4, norm[4]);
        gl.uniform3fv(program.u_c5, norm[5]);
        gl.useProgram(null);
    }
    setColors();

    return {
        draw: function() {
            gl.useProgram(program);
            gl.uniform1i(program.u_pressure, 1);
            gl.uniform1i(program.u_background, 2);
            gl.uniform1f(program.u_gridScale, constants.gridScale);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, framebuffers.velocity.texture);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, framebuffers.pressure.texture);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            vertexHandler.drawClosure();
        },

        setColors: setColors
    };
}

function makeFbo(gl, width, height, params) {

    function newBuffer() {
        var texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

        var format = params && params.format ? params.format : gl.RGB;
        var type = params && params.type ? params.type : gl.UNSIGNED_BYTE;
        gl.texImage2D(gl.TEXTURE_2D, 0, format, width, height, 0, format, type, null);

        var fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        return { 'fbo': fbo, 'texture': texture };
    }

    var frontBuffer = newBuffer();
    var obj = {};

    if (params && params.backbuffer === true) {

        var backBuffer = newBuffer();
        
        Object.defineProperty(obj, 'texture', {
            get: function() { return frontBuffer.texture; }
        });

        obj.use = function() {
            var tmp = frontBuffer;
            frontBuffer = backBuffer;
            backBuffer = tmp;

            gl.bindFramebuffer(gl.FRAMEBUFFER, frontBuffer.fbo);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, backBuffer.texture);
        };
    }
    else {
        obj.texture = frontBuffer.texture;
        obj.use = function() {
            gl.bindFramebuffer(gl.FRAMEBUFFER, frontBuffer.fbo);
        };
    }

    return obj;
}

function makeProgram(gl, vertexShaderID, fragmentShaderID, params) {
    var program = gl.createProgram();

    var vertexShader = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vertexShader, document.getElementById(vertexShaderID).innerHTML);
    gl.compileShader(vertexShader);
    gl.attachShader(program, vertexShader);

    var fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fragmentShader, document.getElementById(fragmentShaderID).innerHTML);
    gl.compileShader(fragmentShader);
    gl.attachShader(program, fragmentShader);

    gl.bindAttribLocation(program, constants.attribs.a_position, 'a_position');
    gl.bindAttribLocation(program, constants.attribs.a_offset, 'a_offset');

    gl.linkProgram(program);

    if (params && params.uniforms) {
        for (var i = 0; i < params.uniforms.length; i++) {
            program[params.uniforms[i]] = gl.getUniformLocation(program, params.uniforms[i]);
        }
    }

    return program;
}

function initGui() {

    var controller = {
        viscosity: 45,
        pressure: 50
    };

    var gui = new dat.GUI();
    gui.add(params, 'resolution', 100, 1500).step(10).name('Resolution').onFinishChange(window.onresize);
    gui.add(params, 'iterations', 1, 100).step(1).name('Accuracy');
    gui.add(controller, 'viscosity', 1, 100).step(1).name('Viscosity').onChange(onViscosityChange);
    gui.add(controller, 'pressure', 0, 100).step(1).name('Pressure').onChange(onPressureChange);
    gui.addColor(params, 'c1').name('Color 1').onChange(programs.screen.setColors);
    gui.addColor(params, 'c2').name('Color 2').onChange(programs.screen.setColors);
    gui.addColor(params, 'c3').name('Color 3').onChange(programs.screen.setColors);
    gui.addColor(params, 'c4').name('Color 4').onChange(programs.screen.setColors);
    gui.addColor(params, 'c5').name('Pressure Color').onChange(programs.screen.setColors);

    function onViscosityChange(x) {
        params.viscosity = polyLerp(x, 1, 50, 100, 1, 11.7, 45);
    }
    onViscosityChange(controller.viscosity);

    function onPressureChange(x) {
        params.pressure = polyLerp(x, 0, 50, 100, 0, 0.75, 1.0);
    }
    onPressureChange(controller.pressure);

    function polyLerp(x, x0, x1, x2, y0, y1, y2) {
        return y0 * (x - x1) * (x - x2) / (x0 - x1) / (x0 - x2) +
               y1 * (x - x0) * (x - x2) / (x1 - x0) / (x1 - x2) +
               y2 * (x - x0) * (x - x1) / (x2 - x0) / (x2 - x1);
    }
}
})();