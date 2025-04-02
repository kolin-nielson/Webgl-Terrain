let gl;
let shaderProgram;
let terrainVertices;
let terrainNormals;
let terrainTexCoords;
let terrainIndices;
let waterVertices;
let waterNormals;
let waterIndices;

let numQuadsX = 100;
let numQuadsY = 100;
let terrainWidth = 30; // Increased terrain size
let terrainDepth = 30;  // Increased terrain size
let waterHeight = -0.6; // Height of the water plane
let waterAlpha = 0.8; // Water transparency
let time = 0; // For animating water

let cameraPosition = [0, 2, 5]; // Initial camera position
let cameraTarget = [0, 0, 0];  // Where the camera is looking
let cameraUp = [0, 1, 0];    // Camera's up direction
let cameraVelocity = [0, 0, 0]; // Camera velocity for smooth movement
let maxSpeed = 0.1;
let inertia = 0.90; // Reduced inertia slightly for tighter control
let cameraHoverHeight = 1.0; // Desired height above terrain/water in Rat's View
let cameraHeightSmoothing = 0.05; // How quickly camera adjusts height (lower = smoother)

let fov = 45 * Math.PI / 180;  // Field of view (radians)
let aspect = 1; // Updated in resizeCanvas
let near = 0.1;
let far = 100;

let viewMode = "rat"; // "rat" or "observation"
let speed = 0.015; // Reduced for more control
let sensitivity = 0.002;  // Mouse sensitivity
let pitch = 0;
let yaw = 0;

let lastMouseX = null;
let lastMouseY = null;

// Fixed Bright Daylight Lighting
let lightPosition = [15, 20, 10]; // High and angled
let ambientColor = [0.3, 0.3, 0.35]; // Brighter ambient for daytime
let diffuseColor = [0.9, 0.9, 0.9]; // Bright diffuse
let specularColor = [0.15, 0.15, 0.15]; // Reduced specular intensity significantly
let shininess = 16; // Reduced shininess for broader, less intense highlights

// Array to track currently pressed keys
const keysPressed = {};

// Texture variables
let grassTexture;
let rockTexture;
let snowTexture;

function main() {
    const canvas = document.querySelector("#glCanvas");
    gl = canvas.getContext("webgl2"); // Use "webgl2" for WebGL 2 context

    if (gl === null) {
        alert("Unable to initialize WebGL. Your browser or machine may not support it.");
        return;
    }

    // Initialize shader programs
    shaderProgram = initShaderProgram(gl, vsSource, fsSource);

    // Build geometry
    [terrainVertices, terrainNormals, terrainTexCoords, terrainIndices] = createTerrain(numQuadsX, numQuadsY, terrainWidth, terrainDepth);
    [waterVertices, waterNormals, waterIndices] = createWater(terrainWidth, terrainDepth, waterHeight);
    
    // Load textures
    loadTerrainTextures(); // Load terrain textures

    // Set up all buffers
    setupBuffers();

    // Add event listeners
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    canvas.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas(); //initial resize

    // Start the render loop
    requestAnimationFrame(render);
}

function setupBuffers() {
    // Terrain buffers
    terrainVertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, terrainVertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(terrainVertices), gl.STATIC_DRAW);

    terrainNormalBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, terrainNormalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(terrainNormals), gl.STATIC_DRAW);
    
    // Add terrain texture coordinate buffer
    terrainTexCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, terrainTexCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(terrainTexCoords), gl.STATIC_DRAW);

    terrainIndexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, terrainIndexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(terrainIndices), gl.STATIC_DRAW);

    // Water buffers
    waterVertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, waterVertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(waterVertices), gl.STATIC_DRAW);

    waterNormalBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, waterNormalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(waterNormals), gl.STATIC_DRAW);

    waterIndexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, waterIndexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(waterIndices), gl.STATIC_DRAW);
}

function render(now) {
    now *= 0.001;  // convert to seconds
    time = now; // Update time for water animation

    processInput(); // Process all key inputs
    drawScene(gl, shaderProgram);
    updateUI();

    requestAnimationFrame(render);
}

function drawScene(gl, program) {
    // Clear with a fixed bright sky color
    const skyColor = [0.6, 0.75, 0.9]; 
    gl.clearColor(skyColor[0], skyColor[1], skyColor[2], 1.0);
    gl.clearDepth(1.0);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    
    // Enable blending for water transparency 
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    let projectionMatrix = mat4.create();
    mat4.perspective(projectionMatrix, fov, aspect, near, far);

    let viewMatrix = mat4.create();
    
    // --- Camera Update Logic --- 
    // Apply velocity for movement
    cameraPosition[0] += cameraVelocity[0];
    cameraPosition[1] += cameraVelocity[1]; // Allow vertical velocity for observation mode
    cameraPosition[2] += cameraVelocity[2];
    
    // Apply friction/inertia
    cameraVelocity[0] *= inertia;
    // Only apply Y inertia in observation mode, Rat's view handles Y differently
    if (viewMode !== 'rat') {
        cameraVelocity[1] *= inertia; 
    } else {
        cameraVelocity[1] = 0; // Reset vertical velocity in Rat's view
    }
    cameraVelocity[2] *= inertia;
    
    // Prevent very small velocities
    if (Math.abs(cameraVelocity[0]) < 0.0001) cameraVelocity[0] = 0;
    if (Math.abs(cameraVelocity[1]) < 0.0001) cameraVelocity[1] = 0;
    if (Math.abs(cameraVelocity[2]) < 0.0001) cameraVelocity[2] = 0;
    // --- End Camera Update Logic ---

    if (viewMode === "rat") {
        // Calculate terrain height directly below camera
        let terrainX = cameraPosition[0];
        let terrainZ = cameraPosition[2];
        let terrainY = terrainHeight(terrainX, terrainZ);

        // Determine desired Y position (hover height above ground or water)
        let desiredY = Math.max(terrainY + cameraHoverHeight, waterHeight + cameraHoverHeight + 0.2); // Add a bit more height over water
        
        // Smoothly interpolate camera height towards the desired height
        cameraPosition[1] = cameraPosition[1] * (1.0 - cameraHeightSmoothing) + desiredY * cameraHeightSmoothing;

        // Create camera direction vector based on yaw and pitch (controlled by mouse)
        let cameraDirection = [
            Math.sin(yaw) * Math.cos(pitch),
            Math.sin(pitch),
            Math.cos(yaw) * Math.cos(pitch)
        ];
        cameraDirection = normalize(cameraDirection);

        // Calculate the target position for lookAt
        cameraTarget = [
            cameraPosition[0] + cameraDirection[0],
            cameraPosition[1] + cameraDirection[1],
            cameraPosition[2] + cameraDirection[2]
        ];
        
        // Apply lookAt
        mat4.lookAt(viewMatrix, cameraPosition, cameraTarget, cameraUp);

    } else {
        // Observation view - free movement
         let cameraDirection = [
            Math.sin(yaw) * Math.cos(pitch),
            Math.sin(pitch),
            Math.cos(yaw) * Math.cos(pitch)
        ];
        cameraDirection = normalize(cameraDirection);
        cameraTarget = [
            cameraPosition[0] + cameraDirection[0],
            cameraPosition[1] + cameraDirection[1],
            cameraPosition[2] + cameraDirection[2]
        ];
        mat4.lookAt(viewMatrix, cameraPosition, cameraTarget, cameraUp);
    }

    // Draw scene elements in order (back to front)
    drawTerrain(gl, program, viewMatrix, projectionMatrix);
    drawWater(gl, program, viewMatrix, projectionMatrix);
}

function drawTerrain(gl, program, viewMatrix, projectionMatrix) {
    gl.useProgram(program);

    // Set up terrain uniforms
    let modelMatrix = mat4.create();
    let normalMatrix = mat3.create();
    mat3.normalFromMat4(normalMatrix, modelMatrix);

    gl.uniformMatrix4fv(gl.getUniformLocation(program, 'uProjectionMatrix'), false, projectionMatrix);
    gl.uniformMatrix4fv(gl.getUniformLocation(program, 'uViewMatrix'), false, viewMatrix);
    gl.uniformMatrix4fv(gl.getUniformLocation(program, 'uModelMatrix'), false, modelMatrix);
    gl.uniformMatrix3fv(gl.getUniformLocation(program, 'uNormalMatrix'), false, normalMatrix);

    gl.uniform3fv(gl.getUniformLocation(program, 'uLightPosition'), lightPosition);
    gl.uniform3fv(gl.getUniformLocation(program, 'uAmbientColor'), ambientColor);
    gl.uniform3fv(gl.getUniformLocation(program, 'uDiffuseColor'), diffuseColor);
    gl.uniform3fv(gl.getUniformLocation(program, 'uSpecularColor'), specularColor);
    gl.uniform1f(gl.getUniformLocation(program, 'uShininess'), shininess);
    gl.uniform3fv(gl.getUniformLocation(program, 'uCameraPosition'), cameraPosition);

    // Add uniform for time and water
    gl.uniform1f(gl.getUniformLocation(program, 'uTime'), time);
    gl.uniform1f(gl.getUniformLocation(program, 'uWaterHeight'), waterHeight);
    gl.uniform1i(gl.getUniformLocation(program, 'uIsWater'), 0); // Not water

    // Bind Textures
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, grassTexture);
    gl.uniform1i(gl.getUniformLocation(program, 'uGrassSampler'), 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, rockTexture);
    gl.uniform1i(gl.getUniformLocation(program, 'uRockSampler'), 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, snowTexture);
    gl.uniform1i(gl.getUniformLocation(program, 'uSnowSampler'), 2);

    // Draw Terrain
    gl.bindBuffer(gl.ARRAY_BUFFER, terrainVertexBuffer);
    gl.vertexAttribPointer(gl.getAttribLocation(program, 'aVertexPosition'), 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(gl.getAttribLocation(program, 'aVertexPosition'));

    gl.bindBuffer(gl.ARRAY_BUFFER, terrainNormalBuffer);
    gl.vertexAttribPointer(gl.getAttribLocation(program, 'aVertexNormal'), 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(gl.getAttribLocation(program, 'aVertexNormal'));
    
    // Enable texture coordinate attribute
    gl.bindBuffer(gl.ARRAY_BUFFER, terrainTexCoordBuffer);
    gl.vertexAttribPointer(gl.getAttribLocation(program, 'aTexCoord'), 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(gl.getAttribLocation(program, 'aTexCoord'));

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, terrainIndexBuffer);
    gl.drawElements(gl.TRIANGLES, terrainIndices.length, gl.UNSIGNED_SHORT, 0);
}

function drawWater(gl, program, viewMatrix, projectionMatrix) {
    gl.useProgram(program);
    
    // Water still uses the same shader program but with different uniform values
    let modelMatrix = mat4.create();
    
    gl.uniformMatrix4fv(gl.getUniformLocation(program, 'uProjectionMatrix'), false, projectionMatrix);
    gl.uniformMatrix4fv(gl.getUniformLocation(program, 'uViewMatrix'), false, viewMatrix);
    gl.uniformMatrix4fv(gl.getUniformLocation(program, 'uModelMatrix'), false, modelMatrix);
    
    // Water specific uniforms - Adjusted for bright daylight
    gl.uniform3fv(gl.getUniformLocation(program, 'uAmbientColor'), [0.1, 0.2, 0.3]); // Slightly brighter ambient
    gl.uniform3fv(gl.getUniformLocation(program, 'uDiffuseColor'), [0.2, 0.5, 0.9]); // Bright blue diffuse
    gl.uniform3fv(gl.getUniformLocation(program, 'uSpecularColor'), [0.8, 0.8, 0.9]); // Strong specular highlights
    gl.uniform1f(gl.getUniformLocation(program, 'uShininess'), 120); // Higher shininess for sharper highlights
    gl.uniform1i(gl.getUniformLocation(program, 'uIsWater'), 1); // Is water
    gl.uniform1f(gl.getUniformLocation(program, 'uTime'), time); // Need time for waves
    gl.uniform3fv(gl.getUniformLocation(program, 'uCameraPosition'), cameraPosition); // Need camera pos for Fresnel
    gl.uniform3fv(gl.getUniformLocation(program, 'uLightPosition'), lightPosition); // Need light pos
    gl.uniform1f(gl.getUniformLocation(program, 'uWaterHeight'), waterHeight); // Needed? Only if shader uses it directly. Keep for now.

    // Draw water vertices
    gl.bindBuffer(gl.ARRAY_BUFFER, waterVertexBuffer);
    gl.vertexAttribPointer(gl.getAttribLocation(program, 'aVertexPosition'), 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(gl.getAttribLocation(program, 'aVertexPosition'));

    gl.bindBuffer(gl.ARRAY_BUFFER, waterNormalBuffer);
    gl.vertexAttribPointer(gl.getAttribLocation(program, 'aVertexNormal'), 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(gl.getAttribLocation(program, 'aVertexNormal'));

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, waterIndexBuffer);
    gl.drawElements(gl.TRIANGLES, waterIndices.length, gl.UNSIGNED_SHORT, 0);

    // Reset necessary uniforms if they were changed specifically for water (e.g., shininess, specular)
    // The main drawTerrain call already sets these back, but good practice if draw order changed.
    gl.uniform3fv(gl.getUniformLocation(program, 'uAmbientColor'), ambientColor); // Reset to default ambient
    gl.uniform3fv(gl.getUniformLocation(program, 'uDiffuseColor'), diffuseColor); // Reset to default diffuse
    gl.uniform3fv(gl.getUniformLocation(program, 'uSpecularColor'), specularColor); // Reset to default specular
    gl.uniform1f(gl.getUniformLocation(program, 'uShininess'), shininess); // Reset to default shininess
}

function handleKeyDown(event) {
    keysPressed[event.key.toLowerCase()] = true;
    
    // Toggle view mode with V
    if (event.key.toLowerCase() === 'v') {
            viewMode = (viewMode === "rat") ? "observation" : "rat";
            if (viewMode === "observation") {
                // Reset camera position/orientation for observation view
                cameraPosition = [0, 5, 10];
                cameraTarget = [0, 0, 0];
                cameraVelocity = [0, 0, 0]; // Reset velocity
                pitch = 0;
                yaw = 0;
            }
        updateUI();
    }
    
    // Prevent default scrolling behavior when arrow keys are pressed
    if (['w', 'a', 's', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key.toLowerCase())) {
        event.preventDefault();
    }
}

function handleKeyUp(event) {
    keysPressed[event.key.toLowerCase()] = false;
}

// Process all currently pressed keys in the animation loop
function processInput() {
    let currentSpeed = speed;
    if (keysPressed['shift']) {
        currentSpeed *= 2; // Double speed with shift
    }
    
    // --- Observation Mode Vertical Movement --- 
    if (viewMode === 'observation') {
        if (keysPressed['q']) {
             cameraVelocity[1] += currentSpeed;
        }
        if (keysPressed['e']) {
             cameraVelocity[1] -= currentSpeed;
        }
    } 
    // --- End Observation Mode Vertical Movement ---

    // Forward/backward
    if (keysPressed['w'] || keysPressed['arrowup']) {
        cameraVelocity[0] += Math.sin(yaw) * currentSpeed;
        cameraVelocity[2] += Math.cos(yaw) * currentSpeed;
    }
    if (keysPressed['s'] || keysPressed['arrowdown']) {
        cameraVelocity[0] -= Math.sin(yaw) * currentSpeed;
        cameraVelocity[2] -= Math.cos(yaw) * currentSpeed;
    }
    
    // Left/right
    if (keysPressed['a'] || keysPressed['arrowleft']) {
        cameraVelocity[0] -= Math.sin(yaw - Math.PI/2) * currentSpeed;
        cameraVelocity[2] -= Math.cos(yaw - Math.PI/2) * currentSpeed;
    }
    if (keysPressed['d'] || keysPressed['arrowright']) {
        cameraVelocity[0] += Math.sin(yaw - Math.PI/2) * currentSpeed;
        cameraVelocity[2] += Math.cos(yaw - Math.PI/2) * currentSpeed;
    }
    
    // Cap maximum velocity
    const capVelocity = (vel) => Math.min(Math.max(vel, -maxSpeed), maxSpeed);
    cameraVelocity[0] = capVelocity(cameraVelocity[0]);
    if(viewMode === 'observation') { // Only cap Y velocity in observation mode
         cameraVelocity[1] = capVelocity(cameraVelocity[1]);
    }
    cameraVelocity[2] = capVelocity(cameraVelocity[2]);
}

let isDragging = false;

function handleMouseDown(event) {
    isDragging = true;
    lastMouseX = event.clientX;
    lastMouseY = event.clientY;
}

function handleMouseUp(event) {
    isDragging = false;
}

function handleMouseMove(event) {
    if (!isDragging) return;

    let deltaX = event.clientX - lastMouseX;
    let deltaY = event.clientY - lastMouseY;

    yaw -= deltaX * sensitivity;
    pitch -= deltaY * sensitivity;

    //Limit pitch
    pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch));


    lastMouseX = event.clientX;
    lastMouseY = event.clientY;
}

function normalize(v) {
    let length = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    if (length > 0.00001) {
        return [v[0] / length, v[1] / length, v[2] / length];
    } else {
        return [0, 0, 0];
    }
}

// Vertex shader program
const vsSource = `#version 300 es

in vec4 aVertexPosition;
in vec3 aVertexNormal;
in vec2 aTexCoord; // Input texture coordinates

uniform mat4 uModelMatrix;
uniform mat4 uViewMatrix;
uniform mat4 uProjectionMatrix;
uniform mat3 uNormalMatrix;

out vec3 vNormal;
out vec3 vPosition;
out float vHeight;
out vec2 vTexCoord; // Output texture coordinates

void main() {
    vPosition = vec3(uModelMatrix * aVertexPosition);
    vNormal = normalize(uNormalMatrix * aVertexNormal);
    vHeight = aVertexPosition.y; // Pass the height to fragment shader
    vTexCoord = aTexCoord; // Pass texture coordinates
    gl_Position = uProjectionMatrix * uViewMatrix * uModelMatrix * aVertexPosition;
}
`;

// Fragment shader program
const fsSource = `#version 300 es
precision highp float;

in vec3 vNormal;
in vec3 vPosition;
in float vHeight;
in vec2 vTexCoord; // Input texture coordinates

// Samplers for terrain textures
uniform sampler2D uGrassSampler;
uniform sampler2D uRockSampler;
uniform sampler2D uSnowSampler;

uniform vec3 uLightPosition;
uniform vec3 uAmbientColor;
uniform vec3 uDiffuseColor;
uniform vec3 uSpecularColor;
uniform float uShininess;
uniform vec3 uCameraPosition;
uniform float uTime; // Keep for water animation
uniform bool uIsWater;
uniform float uWaterHeight; 

out vec4 fragColor;

// Function to blend textures based on height and slope 
vec3 blendTerrainTextures(vec3 normal) {
    float slope = 1.0 - max(0.0, normal.y); // 0=flat, 1=vertical
    float height = vHeight;

    vec3 grassColor = texture(uGrassSampler, vTexCoord).rgb;
    vec3 rockColor = texture(uRockSampler, vTexCoord).rgb;
    vec3 snowColor = texture(uSnowSampler, vTexCoord).rgb;
    
    // Define transition zones - Adjusted for slightly wider blends
    float grassRockTransition = 0.5; float grassRockSharpness = 0.5;
    float rockSnowTransition = 1.7; float rockSnowSharpness = 0.6;
    float slopeThreshold = 0.35; float slopeSharpness = 0.35; // Rock appears on slopes > 0.35
    
    // Blend based on height
    float rockMixHeight = smoothstep(grassRockTransition - grassRockSharpness, grassRockTransition + grassRockSharpness, height);
    float snowMix = smoothstep(rockSnowTransition - rockSnowSharpness, rockSnowTransition + rockSnowSharpness, height);

    // Blend based on slope 
    float slopeMix = smoothstep(slopeThreshold - slopeSharpness, slopeThreshold + slopeSharpness, slope);
    
    // Combine: Start with grass, mix in rock based on height OR slope, then mix in snow based on height
    vec3 color = mix(grassColor, rockColor, max(rockMixHeight, slopeMix)); // Use rock if high enough OR steep enough
    color = mix(color, snowColor, snowMix); // Override with snow if high enough

    return color;
}

void main() {
    vec3 normal = normalize(vNormal);
    
    // Wave effect for water
    if (uIsWater) {
        float waveFactor1 = sin(vPosition.x * 1.5 + uTime * 0.6) * 0.05;
        float waveFactor2 = cos(vPosition.z * 1.5 + uTime * 0.4) * 0.05;
        normal = normalize(vec3(normal.x + waveFactor1, normal.y, normal.z + waveFactor2));
    }
    
    vec3 lightDirection = normalize(uLightPosition - vPosition);
    vec3 viewDirection = normalize(uCameraPosition - vPosition);
    vec3 reflectionDirection = reflect(-lightDirection, normal);

    // Lighting components
    vec3 ambient = uAmbientColor;
    float diffuseFactor = max(dot(normal, lightDirection), 0.0);
    vec3 diffuse = diffuseFactor * uDiffuseColor;
    float specularFactor = pow(max(dot(viewDirection, reflectionDirection), 0.0), uShininess);
    vec3 specular = specularFactor * uSpecularColor;

    vec3 calculatedBaseColor = vec3(1.0);
    float alpha = 1.0;
    
    if (uIsWater) {
        // Water shading (unchanged)
        calculatedBaseColor = vec3(0.1, 0.4, 0.7); 
        float waterPattern = sin(vPosition.x * 2.0 + uTime * 1.0) * cos(vPosition.z * 2.0 + uTime * 0.7) * 0.02;
        calculatedBaseColor += vec3(waterPattern * 0.5, waterPattern * 0.5, waterPattern); 
        float fresnelFactor = pow(1.0 - max(dot(normal, viewDirection), 0.0), 4.5); 
        vec3 skyColor = vec3(0.6, 0.75, 0.9); 
        calculatedBaseColor = mix(calculatedBaseColor, skyColor, fresnelFactor * 0.75);
        specular *= fresnelFactor * 1.5; 
        alpha = 0.80; 
    } else { // Terrain 
        // Use texture blending for terrain color
        calculatedBaseColor = blendTerrainTextures(normal);
    }
    
    // Apply lighting
    vec3 finalColor = calculatedBaseColor * (ambient + diffuse) + specular;
    
    // Gamma correction
    finalColor = pow(finalColor, vec3(0.8)); 
    
    fragColor = vec4(finalColor, alpha);
}
`;

function updateUI() {
    // Update view mode text
    const viewModeElement = document.getElementById('viewMode');
    viewModeElement.textContent = `View Mode: ${viewMode === 'rat' ? 'Rat\\\'s View' : 'Observation View'}`;
    
    // Update position information
    const positionElement = document.getElementById('position');
    positionElement.textContent = `Position: X: ${cameraPosition[0].toFixed(2)}, Y: ${cameraPosition[1].toFixed(2)}, Z: ${cameraPosition[2].toFixed(2)}`;
    
    // Update terrain height information
    if (viewMode === 'rat') {
        const terrainX = cameraPosition[0];
        const terrainZ = cameraPosition[2];
        const height = terrainHeight(terrainX, terrainZ);
        const terrainElement = document.getElementById('terrain');
        terrainElement.textContent = `Terrain Height: ${height.toFixed(2)}`;
    } else {
         // Optionally clear or hide terrain height in observation mode
         const terrainElement = document.getElementById('terrain');
         if (terrainElement) {
             terrainElement.textContent = 'Terrain Height: N/A';
         }
    }
}

function resizeCanvas() {
    const canvas = document.querySelector("#glCanvas");
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    gl.viewport(0, 0, canvas.width, canvas.height);
    aspect = canvas.width / canvas.height;
}

function createTerrain(numQuadsX, numQuadsY, width, depth) {
    let vertices = [];
    let normals = [];
    let texCoords = []; // Array for texture coordinates
    let indices = [];

    let xOffset = -width / 2;
    let yOffset = -depth / 2;
    const uvScale = 5.0; // Scale UVs to repeat texture

    for (let y = 0; y <= numQuadsY; y++) {
        for (let x = 0; x <= numQuadsX; x++) {
            let u = x / numQuadsX;
            let v = y / numQuadsY;
            let worldX = u * width + xOffset;
            let worldY = v * depth + yOffset; // Use worldY for Z-axis in world space
            let height = terrainHeight(worldX, worldY); 
            vertices.push(worldX, height, worldY);

            // Texture Coordinates based on world X/Z
            texCoords.push(worldX / uvScale, worldY / uvScale);

            // Calculate normal (approximation using neighboring vertices)
            let dzdx = (terrainHeight(worldX + 0.1, worldY) - height) / 0.1;
            let dzdy = (terrainHeight(worldX, worldY + 0.1) - height) / 0.1;
            let normal = normalize([-dzdx, 1, -dzdy]);
            normals.push(normal[0], normal[1], normal[2]);
        }
    }

    for (let y = 0; y < numQuadsY; y++) {
        for (let x = 0; x < numQuadsX; x++) {
            let topLeft = x + y * (numQuadsX + 1);
            let topRight = (x + 1) + y * (numQuadsX + 1);
            let bottomLeft = x + (y + 1) * (numQuadsX + 1);
            let bottomRight = (x + 1) + (y + 1) * (numQuadsX + 1);

            indices.push(topLeft, bottomLeft, topRight);
            indices.push(topRight, bottomLeft, bottomRight);
        }
    }
    return [vertices, normals, texCoords, indices]; // Return texCoords
}

function terrainHeight(x, y) {
    // Generate hills using combinations of sines and cosines as per specification
    let height = 0;
    
    // Primary large-scale hills
    height += Math.cos(x * 0.15 + 1.0) * Math.sin(y * 0.1) * 2.5;
    
    // Secondary medium-scale features
    height += Math.sin(x * 0.4) * Math.cos(y * 0.3 + 2.0) * 1.2;
    
    // Smaller details and variations
    height += Math.cos(x * 0.8 + y * 0.5) * 0.5;
    height += Math.sin(x * 1.2 - y * 0.9) * 0.3;
    
    // Product of sines/cosines for sharper features
    height += Math.sin(x * 0.6) * Math.cos(y * 0.6) * 0.8;
    
    // Gentle background undulation
    height += Math.sin(x * 0.05 + 3.0) * 0.4;
    
    // Add a slight offset to raise the overall terrain slightly
    height += 0.2;
    
    return height;
}

function createWater(width, depth, height) {
    // Create more detailed water with more vertices
    const segments = 20; // More segments for water animation
    const vertices = [];
    const normals = [];
    const indices = [];
    
    const segmentWidth = width / segments;
    const segmentDepth = depth / segments;
    
    // Create vertices in a grid
    for (let z = 0; z <= segments; z++) {
        for (let x = 0; x <= segments; x++) {
            const xPos = (x * segmentWidth) - width / 2;
            const zPos = (z * segmentDepth) - depth / 2;
            
            vertices.push(xPos, height, zPos);
            normals.push(0, 1, 0); // All normals point up for flat water
        }
    }
    
    // Create indices for triangles
    for (let z = 0; z < segments; z++) {
        for (let x = 0; x < segments; x++) {
            const topLeft = z * (segments + 1) + x;
            const topRight = topLeft + 1;
            const bottomLeft = (z + 1) * (segments + 1) + x;
            const bottomRight = bottomLeft + 1;
            
            // First triangle
            indices.push(topLeft, bottomLeft, topRight);
            // Second triangle
            indices.push(topRight, bottomLeft, bottomRight);
        }
    }
    
    return [vertices, normals, indices];
}

function initShaderProgram(gl, vsSource, fsSource) {
    const vertexShader = loadShader(gl, gl.VERTEX_SHADER, vsSource);
    const fragmentShader = loadShader(gl, gl.FRAGMENT_SHADER, fsSource);

    // Check if shaders compiled successfully
    if (!vertexShader || !fragmentShader) {
        console.error("Failed to create shaders"); // Log error
        return null; // Return null if shader creation failed
    }

    const shaderProgram = gl.createProgram();
    gl.attachShader(shaderProgram, vertexShader);
    gl.attachShader(shaderProgram, fragmentShader);
    gl.linkProgram(shaderProgram);

    if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
        console.error('Unable to initialize the shader program: ' + gl.getProgramInfoLog(shaderProgram));
        return null;
    }

    return shaderProgram;
}

function loadShader(gl, type, source) {
    const shader = gl.createShader(type);

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('An error occurred compiling the shaders: ' + gl.getShaderInfoLog(shader)); // Log to console for more details
        gl.deleteShader(shader);
        return null;
    }

    return shader;
}

// Function to load terrain textures
function loadTerrainTextures() {
    // Trying different public URLs hosted on GitHub Pages (Stemkoski examples)
    grassTexture = loadTexture('https://stemkoski.github.io/Three.js/images/grass-512.jpg'); 
    rockTexture = loadTexture('https://stemkoski.github.io/Three.js/images/rock-512.jpg'); 
    snowTexture = loadTexture('https://stemkoski.github.io/Three.js/images/snow-512.jpg'); 
}

// Helper function to load a texture
function loadTexture(url) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);

    // Placeholder pixel
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 255, 255]));

    const image = new Image();
    image.src = url;
    image.crossOrigin = "anonymous"; // REQUIRED for textures from other domains
    image.onload = function() {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    };
    image.onerror = function() {
        console.error("Failed to load texture:", url);
    }
    return texture;
}

window.onload = main;