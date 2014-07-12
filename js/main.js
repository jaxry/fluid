
(function() { //scoping function to contain global variables

'use strict';
main();

var gl, canvas, programs, framebuffers, vertexHandler, input, constants;

function main() {
    init();
    animate();
}

function init() {
    framebuffers = {};
    programs = {};
    input = {
        smoothing: 8
    };
    constants = {
        pixelX: null,
        pixelY: null,
        aspectRatio: null,
        backgroundTexture: null,
        attribs: {
            'a_position': 0,
            'a_offset': 1
        }
    };

    canvas =  document.getElementById('canvas');
    gl = canvas.getContext('webgl');

    if (!gl){
        alert('Your browser does not support WebGL.');
    }

    if (!gl.getExtension('OES_texture_float') || !gl.getExtension('OES_texture_float_linear')) {
        alert('Your browser does not support floating point textures.');
    }


    window.onresize = function() {
        canvas.width = window.innerWidth / 2;
        canvas.height = window.innerHeight / 2;

        gl.viewport(0, 0, canvas.width, canvas.height);

        constants.pixelX = 1 / canvas.width;
        constants.pixelY = 1 / canvas.height;

        vertexHandler = makeVertexHandler();

        framebuffers.velocity = makeFbo(gl, canvas.width, canvas.height, {backbuffer: true, format: gl.RGB, type: gl.FLOAT});
        framebuffers.pressure = makeFbo(gl, canvas.width, canvas.height, {backbuffer: true, format: gl.RGB, type: gl.FLOAT});

        programs.fluidSim = makeFluidSimProgram();
        programs.screen = makeScreenProgram();
    };
    window.onresize();

    programs.addForce = makeAddForceProgram();

    canvas.onmousemove = mouseHandler;

    function mouseHandler(e) {

        function smooth(member, array) {

            for (var i = 0; i < input.smoothing; i++) {
                input[member] += mouseHandler[array][i];
            }
            input[member] /= input.smoothing + 1;
            for (var i = 0; i < input.smoothing-1; i++){
                mouseHandler[array][i] = mouseHandler[array][i+1];
            }
            mouseHandler[array][input.smoothing-1] = input[member];
        }

        if (!mouseHandler.x0) {
            mouseHandler.x0 = e.clientX;
            mouseHandler.y0 = e.clientY;
            mouseHandler.t0 = Date.now();
            mouseHandler.dx0 = new Array(input.smoothing);
            mouseHandler.dy0 = new Array(input.smoothing);
            mouseHandler.speed0 = new Array(input.smoothing);
            for (var i = 0; i < input.smoothing; i++){
                mouseHandler.dx0[i] = 0;
                mouseHandler.dy0[i] = 0;
                mouseHandler.speed0[i] = 0.001;
            }
        }
        input.mouseX = e.clientX / window.innerWidth;
        input.mouseY = 1 - e.clientY / window.innerHeight;

        input.mouseDx = e.clientX - mouseHandler.x0;
        input.mouseDy = mouseHandler.y0 - e.clientY;

        var time = Date.now();
        input.speed = Math.max(Math.abs(input.mouseDx), Math.abs(input.mouseDy)) / Math.max(time - mouseHandler.t0, 0.001);
        input.speed = Math.min(input.speed, 2);

        smooth('mouseDx', 'dx0');
        smooth('mouseDy', 'dy0');
        smooth('speed', 'speed0');

        mouseHandler.x0 = e.clientX;
        mouseHandler.y0 = e.clientY;
        mouseHandler.t0 = time;

        programs.addForce.draw();
    }
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

function makeAddForceProgram() {

    var program = makeProgram(gl, 'vertex-shader', 'add-force-shader',
                             {uniforms: ['u_mouse', 'u_mouseDelta', 'u_speed', 'u_resolution']});

    return {
        draw: function() {
            gl.useProgram(program);
            gl.uniform2f(program.u_mouse, input.mouseX, input.mouseY);
            gl.uniform2f(program.u_mouseDelta, input.mouseDx, input.mouseDy);
            gl.uniform1f(program.u_speed, input.speed);
            gl.uniform2f(program.u_resolution, canvas.width, canvas.height);
            framebuffers.velocity.use();
            vertexHandler.drawInterior();
        }
    };
}

function makeFluidSimProgram() {


    var pAdvect       = makeProgram(gl, 'vertex-shader', 'advect-shader',
                                    {uniforms: ['u_resolution']}),

        pDiffuse      = makeProgram(gl, 'vertex-shader', 'diffuse-shader',
                                    {uniforms: ['u_onePixel']}),

        pDivergence   = makeProgram(gl, 'vertex-shader', 'divergence-shader',
                                    {uniforms: ['u_resolution', 'u_onePixel']}),
        
        pZeroPressure = makeProgram(gl, 'vertex-shader', 'zero-color-shader'),
    
        pJacobi       = makeProgram(gl, 'vertex-shader', 'poisson-jacobi-shader',
                                    {uniforms: ['u_onePixel', 'u_divergence']}),

        pSubtraction  = makeProgram(gl, 'vertex-shader', 'gradient-subtract-shader',
                                    {uniforms: ['u_resolution', 'u_onePixel', 'u_pressure']}),
        
        pBoundary     = makeProgram(gl, 'vertex-shader', 'boundary-condition-shader',
                                    {uniforms: ['u_scale']});


    var fboDivergence = makeFbo(gl, canvas.width, canvas.height, {format: gl.RGB, type: gl.FLOAT});

    function drawBoundary(scale) {
        gl.useProgram(pBoundary);
        gl.uniform1f(pBoundary.u_scale, scale);
        vertexHandler.drawBoundary();
    }

    return {
        draw: function() {

            // advect
            gl.useProgram(pAdvect);
            gl.uniform2f(pAdvect.u_resolution, canvas.width, canvas.height);
            framebuffers.velocity.use();
            vertexHandler.drawInterior();
            drawBoundary(-1);

            // diffuse
            // gl.useProgram(pDiffuse);
            // gl.uniform2f(pDiffuse.u_onePixel, constants.pixelX, constants.pixelY);
            // for (var i = 0; i < 20; i++) {
            //     gl.useProgram(pDiffuse);
            //     framebuffers.velocity.use();
            //     vertexHandler.drawInterior();
            //     drawBoundary(-1);
            // }

            // project
            gl.useProgram(pDivergence);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, framebuffers.velocity.texture);
            gl.uniform2f(pDivergence.u_onePixel, constants.pixelX, constants.pixelY);
            gl.uniform2f(pDivergence.u_resolution, canvas.width, canvas.height);
            fboDivergence.use();
            vertexHandler.drawInterior();
            drawBoundary(1);

            gl.useProgram(pZeroPressure);
            framebuffers.pressure.use();
            vertexHandler.drawClosure();

            gl.useProgram(pJacobi);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, fboDivergence.texture);
            gl.uniform1i(pJacobi.u_divergence, 1);
            gl.uniform2f(pJacobi.u_onePixel, constants.pixelX, constants.pixelY);
            for (var i = 0; i < 80; i++) {
                gl.useProgram(pJacobi);
                framebuffers.pressure.use();
                vertexHandler.drawInterior();
                drawBoundary(1);
            }

            gl.useProgram(pSubtraction);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, framebuffers.pressure.texture);
            gl.uniform1i(pSubtraction.u_pressure, 1);
            gl.uniform2f(pSubtraction.u_onePixel, constants.pixelX, constants.pixelY);
            gl.uniform2f(pSubtraction.u_resolution, canvas.width, canvas.height);
            framebuffers.velocity.use();
            vertexHandler.drawInterior();
            drawBoundary(-1);
        }
    };
}

function makeScreenProgram() {
    var program = makeProgram(gl, 'vertex-shader', 'screen-shader',
                              {uniforms: ['u_pressure', 'u_background']});

    var backgroundTexture = function setBackground() {
        var tempProg = makeProgram(gl, 'vertex-shader', 'background-shader');
        var tempFbo = makeFbo(gl, canvas.width, canvas.height);
        gl.useProgram(tempProg);
        tempFbo.use();
        vertexHandler.drawClosure();
        gl.useProgram(null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return tempFbo.texture;
    }();

    return {
        draw: function() {
            gl.useProgram(program);
            gl.uniform1i(program.u_pressure, 1);
            gl.uniform1i(program.u_background, 2);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, framebuffers.velocity.texture);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, framebuffers.pressure.texture);
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, backgroundTexture);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            vertexHandler.drawClosure();
        }
    };
}

function animate() {
    programs.fluidSim.draw();
    programs.screen.draw();
    window.requestAnimationFrame(animate);
}

// gl.bindAttribLocation(program, 0, 'a_position');
// gl.bindAttribLocation(program, 1, 'a_offset');

// generic functions

function makeFbo(gl, width, height, params) {

    function newBuffer() {
        var texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

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

    gl.bindAttribLocation(program, 0, 'a_position');
    gl.bindAttribLocation(program, 1, 'a_offset');

    gl.linkProgram(program);

    if (params && params.uniforms) {
        for (var i = 0; i < params.uniforms.length; i++) {
            program[params.uniforms[i]] = gl.getUniformLocation(program, params.uniforms[i]);
        }
    }

    return program;
}

})();