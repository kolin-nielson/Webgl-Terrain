// Import Simplex Noise
import { createNoise2D } from './node_modules/simplex-noise/dist/esm/simplex-noise.js';

let gl;
let shaderProgram;
let terrainVertices;
let terrainNormals;
let terrainTexCoords;
let terrainIndices;
let waterVertices;
let waterNormals;
let waterIndices;
let waterVertexBuffer;
let waterNormalBuffer;
let waterIndexBuffer;

// Noise variables for terrain generation
let noise2D;
let terrainSeed = Math.random() * 10000; // Random initial seed
let noiseScale = 0.05; // Controls the scale of the noise (smaller = more stretched out features)
let noiseOctaves = 4; // Number of noise layers
let noiseAmplitude = 1.8; // Overall height of the terrain
let noisePersistence = 0.45; // How much each octave contributes
let terrainFlatness = 0.6; // Controls how flat vs. mountainous the terrain is (0-1)
let terrainOffset = 0.0; // Vertical offset for the entire terrain

let numQuadsX = 100;
let numQuadsY = 100;
const QUAD_SIZE = 0.3; // Physical size of one terrain quad (adjust for scale)
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

let anisotropyExt; // For anisotropic filtering

// --- Performance & Infinite Terrain ---
// let terrainChunks = []; // Replaced by activeChunks Map
let activeChunks = new Map(); // Stores currently loaded chunks (key: "x_y", value: chunkObject)
const CHUNK_SIZE_QUADS = 20; // How many quads per side in a chunk
const RENDER_DISTANCE_CHUNKS = 20; // Load chunks within this distance (Increased from 4)
// let numChunksX; // Removed - terrain is infinite
// let numChunksY; // Removed - terrain is infinite
let lastFrameTime = 0;
let fpsDisplay;
// --- End Performance & Infinite Terrain ---

// Initialize noise generator with a seed
function initNoise() {
    // Create a seeded random function
    const seededRandom = function() {
        // Simple seeded random function
        terrainSeed = (terrainSeed * 9301 + 49297) % 233280;
        return terrainSeed / 233280;
    };

    // Create a new noise generator with our seeded random function
    noise2D = createNoise2D(seededRandom);
}

// Generate a new random terrain
function regenerateTerrain() {
    terrainSeed = Math.random() * 10000;
    initNoise();

    // Clear existing chunks to force regeneration
    for (const chunkKey of activeChunks.keys()) {
        const chunk = activeChunks.get(chunkKey);
        if (chunk.vertexBuffer) gl.deleteBuffer(chunk.vertexBuffer);
        if (chunk.normalBuffer) gl.deleteBuffer(chunk.normalBuffer);
        if (chunk.texCoordBuffer) gl.deleteBuffer(chunk.texCoordBuffer);
        if (chunk.indexBuffer) gl.deleteBuffer(chunk.indexBuffer);
    }
    activeChunks.clear();

    // Force chunks to reload
    manageChunks();
}

// Function to update terrain based on slider values
function updateTerrainParameters() {
    // Get values from sliders
    noiseScale = parseFloat(document.getElementById('noiseScale').value);
    noiseAmplitude = parseFloat(document.getElementById('noiseAmplitude').value);
    terrainFlatness = parseFloat(document.getElementById('terrainFlatness').value);
    terrainOffset = parseFloat(document.getElementById('terrainOffset').value);

    // Update display values
    document.getElementById('noiseScaleValue').textContent = noiseScale.toFixed(2);
    document.getElementById('noiseAmplitudeValue').textContent = noiseAmplitude.toFixed(1);
    document.getElementById('terrainFlatnessValue').textContent = terrainFlatness.toFixed(2);
    document.getElementById('terrainOffsetValue').textContent = terrainOffset.toFixed(1);

    // Regenerate terrain with current seed
    // Clear existing chunks to force regeneration
    for (const chunkKey of activeChunks.keys()) {
        const chunk = activeChunks.get(chunkKey);
        if (chunk.vertexBuffer) gl.deleteBuffer(chunk.vertexBuffer);
        if (chunk.normalBuffer) gl.deleteBuffer(chunk.normalBuffer);
        if (chunk.texCoordBuffer) gl.deleteBuffer(chunk.texCoordBuffer);
        if (chunk.indexBuffer) gl.deleteBuffer(chunk.indexBuffer);
    }
    activeChunks.clear();

    // Force chunks to reload
    manageChunks();
}

function main() {
    const canvas = document.querySelector("#glCanvas");
    gl = canvas.getContext("webgl2"); // Use "webgl2" for WebGL 2 context

    // --- FPS Counter ---
    fpsDisplay = document.getElementById('fps');
    if (!fpsDisplay) {
        console.warn("FPS display element with id 'fps' not found.");
    }
    lastFrameTime = performance.now();
    // --- End FPS Counter ---

    if (gl === null) {
        alert("Unable to initialize WebGL. Your browser or machine may not support it.");
        return;
    }

    // Initialize noise generator
    initNoise();

    // Set up terrain control sliders
    document.getElementById('noiseScale').addEventListener('input', updateTerrainParameters);
    document.getElementById('noiseAmplitude').addEventListener('input', updateTerrainParameters);
    document.getElementById('terrainFlatness').addEventListener('input', updateTerrainParameters);
    document.getElementById('terrainOffset').addEventListener('input', updateTerrainParameters);

    // Get anisotropic filtering extension
    anisotropyExt = gl.getExtension('EXT_texture_filter_anisotropic') ||
                    gl.getExtension('MOZ_EXT_texture_filter_anisotropic') ||
                    gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');

    if (!anisotropyExt) {
        console.warn("Anisotropic filtering extension not available.");
    }

    // Initialize shader programs
    shaderProgram = initShaderProgram(gl, vsSource, fsSource);

    // Build geometry
    // createTerrainChunks(...) is removed - Chunks generated on the fly
    // Note: Water is still a fixed size plane. Making water infinite requires different techniques.
    const waterPlaneSize = 200; // Define a large size for the water plane
    [waterVertices, waterNormals, waterIndices] = createWater(waterPlaneSize, waterPlaneSize, waterHeight); // Create a reasonably sized water plane for now

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

    // Load initial chunks around the starting camera position
    manageChunks();

    // Start the render loop
    requestAnimationFrame(render);
}

function setupBuffers() {
    // --- Terrain Chunk Buffers are now created in createSingleChunk ---
    // Remove the loop that iterated over activeChunks here.

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
    // --- FPS Calculation ---
    const currentTime = performance.now();
    // Ensure lastFrameTime is not 0 to avoid NaN/Infinity on the first frame
    const deltaTime = lastFrameTime > 0 ? (currentTime - lastFrameTime) / 1000.0 : 0;
    lastFrameTime = currentTime;
    // Avoid division by zero if deltaTime is extremely small
    const fps = deltaTime > 0 ? Math.round(1.0 / deltaTime) : 0;
    if (fpsDisplay) {
        fpsDisplay.textContent = `FPS: ${fps}`;
    }
    // --- End FPS Calculation ---

    now *= 0.001;  // convert to seconds
    time = now; // Update time for water animation

    processInput(); // Process all key inputs
    manageChunks(); // Load/Unload chunks based on camera position
    drawScene(gl, shaderProgram);
    updateUI();

    requestAnimationFrame(render);
}

function drawScene(gl, program) {
    // Clear with a fixed bright sky color - refined slightly
    const skyColor = [0.55, 0.75, 0.95];
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

    // --- Camera Wrapping for Infinite Terrain ---
    /* Removed - replaced by dynamic chunk loading
    const halfWidth = terrainWidth / 2;
    const halfDepth = terrainDepth / 2;
    if (cameraPosition[0] > halfWidth) cameraPosition[0] -= terrainWidth;
    if (cameraPosition[0] < -halfWidth) cameraPosition[0] += terrainWidth;
    if (cameraPosition[2] > halfDepth) cameraPosition[2] -= terrainDepth;
    if (cameraPosition[2] < -halfDepth) cameraPosition[2] += terrainDepth;
    */
    // --- End Camera Wrapping ---

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

    // --- Frustum Calculation ---
    let viewProjectionMatrix = mat4.create();
    mat4.multiply(viewProjectionMatrix, projectionMatrix, viewMatrix);
    let frustumPlanes = extractFrustumPlanes(viewProjectionMatrix);
    // --- End Frustum Calculation ---

    // Draw scene elements in order (back to front)
    drawTerrain(gl, program, viewMatrix, projectionMatrix, frustumPlanes);
    drawWater(gl, program, viewMatrix, projectionMatrix);
}

function drawTerrain(gl, program, viewMatrix, projectionMatrix, frustumPlanes) {
    gl.useProgram(program);

    // Set common uniforms (lighting, camera, textures) - these don't change per chunk
    gl.uniformMatrix4fv(gl.getUniformLocation(program, 'uProjectionMatrix'), false, projectionMatrix);
    gl.uniformMatrix4fv(gl.getUniformLocation(program, 'uViewMatrix'), false, viewMatrix);
    // ModelMatrix is identity for terrain, set once if needed (or handle per-chunk if chunks moved)
    let modelMatrix = mat4.create(); // Identity for static terrain chunks
    gl.uniformMatrix4fv(gl.getUniformLocation(program, 'uModelMatrix'), false, modelMatrix);
    let normalMatrix = mat3.create();
    mat3.normalFromMat4(normalMatrix, modelMatrix); // Calculate normal matrix from model matrix
    gl.uniformMatrix3fv(gl.getUniformLocation(program, 'uNormalMatrix'), false, normalMatrix);

    gl.uniform3fv(gl.getUniformLocation(program, 'uLightPosition'), lightPosition);
    gl.uniform3fv(gl.getUniformLocation(program, 'uAmbientColor'), ambientColor);
    gl.uniform3fv(gl.getUniformLocation(program, 'uDiffuseColor'), diffuseColor);
    gl.uniform3fv(gl.getUniformLocation(program, 'uSpecularColor'), specularColor);
    gl.uniform1f(gl.getUniformLocation(program, 'uShininess'), shininess);
    gl.uniform3fv(gl.getUniformLocation(program, 'uCameraPosition'), cameraPosition);
    gl.uniform1f(gl.getUniformLocation(program, 'uTime'), time);
    gl.uniform1f(gl.getUniformLocation(program, 'uWaterHeight'), waterHeight);
    gl.uniform1i(gl.getUniformLocation(program, 'uIsWater'), 0); // Not water

    // Bind Textures (once is enough)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, grassTexture); gl.uniform1i(gl.getUniformLocation(program, 'uGrassSampler'), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, rockTexture); gl.uniform1i(gl.getUniformLocation(program, 'uRockSampler'), 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, snowTexture); gl.uniform1i(gl.getUniformLocation(program, 'uSnowSampler'), 2);

    // --- Draw Visible Chunks ---
    const posAttribLoc = gl.getAttribLocation(program, 'aVertexPosition');
    const normalAttribLoc = gl.getAttribLocation(program, 'aVertexNormal');
    const texCoordAttribLoc = gl.getAttribLocation(program, 'aTexCoord');

    // Enable attributes once before the loop
    gl.enableVertexAttribArray(posAttribLoc);
    gl.enableVertexAttribArray(normalAttribLoc);
    gl.enableVertexAttribArray(texCoordAttribLoc);

    // Iterate through active chunks
    for (let chunk of activeChunks.values()) {
        // Frustum Culling Check
        if (!intersectFrustumAABB(frustumPlanes, chunk.boundingBox)) {
             //console.log("Culled chunk"); // Optional: for debugging
             continue; // Skip this chunk if it's outside the frustum
        }
        //console.log("Drawing chunk"); // Optional: for debugging

        // Check if buffers are ready (they might be loading asynchronously)
        if (!chunk.vertexBuffer || !chunk.indexBuffer) {
            // console.log("Chunk buffers not ready, skipping draw");
            continue; // Skip drawing if buffers aren't initialized
        }

        // Bind chunk-specific buffers
        gl.bindBuffer(gl.ARRAY_BUFFER, chunk.vertexBuffer);
        gl.vertexAttribPointer(posAttribLoc, 3, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, chunk.normalBuffer);
        gl.vertexAttribPointer(normalAttribLoc, 3, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, chunk.texCoordBuffer);
        gl.vertexAttribPointer(texCoordAttribLoc, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, chunk.indexBuffer);
        gl.drawElements(gl.TRIANGLES, chunk.indices.length, gl.UNSIGNED_SHORT, 0);
    }
    // --- End Draw Visible Chunks ---

    // Disable vertex attrib arrays after drawing all chunks (optional good practice)
    gl.disableVertexAttribArray(posAttribLoc);
    gl.disableVertexAttribArray(normalAttribLoc);
    gl.disableVertexAttribArray(texCoordAttribLoc);
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

    // Generate new terrain with R key
    if (event.key.toLowerCase() === 'r') {
        regenerateTerrain();
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

function handleMouseUp() {
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

// Vertex shader program - Reverted to basic version without tangents/TBN
const vsSource = `#version 300 es

in vec4 aVertexPosition;
in vec3 aVertexNormal;
in vec2 aTexCoord;

uniform mat4 uModelMatrix;
uniform mat4 uViewMatrix;
uniform mat4 uProjectionMatrix;
uniform mat3 uNormalMatrix;

out vec3 vNormal; // Pass Normal in World Space
out vec3 vPosition; // Pass Position in World Space
out vec2 vTexCoord;

void main() {
    vPosition = vec3(uModelMatrix * aVertexPosition);
    vTexCoord = aTexCoord;
    vNormal = normalize(uNormalMatrix * aVertexNormal);
    gl_Position = uProjectionMatrix * uViewMatrix * uModelMatrix * aVertexPosition;
}
`;

// Fragment shader program - Add shoreline foam logic
const fsSource = `#version 300 es
precision highp float;

in vec3 vNormal;
in vec3 vPosition;
in vec2 vTexCoord;

// Samplers
uniform sampler2D uGrassSampler;
uniform sampler2D uRockSampler;
uniform sampler2D uSnowSampler;

// Uniforms
uniform vec3 uLightPosition;
uniform vec3 uAmbientColor;
uniform vec3 uDiffuseColor;
uniform vec3 uSpecularColor;
uniform float uShininess;
uniform vec3 uCameraPosition;
uniform float uTime;
uniform bool uIsWater;
uniform float uWaterHeight;

out vec4 fragColor;

// Slightly better hash function for noise generation
// Source: Commonly found online, e.g., Book of Shaders
float hash( vec2 p ) {
    p = vec2( dot(p,vec2(127.1,311.7)), dot(p,vec2(269.5,183.3)) );
    // Return value in [-1, 1] for easier use
    return -1.0 + 2.0 * fract(sin(p.x)*43758.5453123);
}

// Function to blend terrain textures (Color only) - REFINED LOGIC
vec3 blendTerrainTextures(vec3 geometricNormal) {
    float slope = 1.0 - max(0.0, geometricNormal.y);
    float height = vPosition.y;

    vec3 grassColor = texture(uGrassSampler, vTexCoord).rgb;
    vec3 rockColor = texture(uRockSampler, vTexCoord).rgb;
    vec3 snowColor = texture(uSnowSampler, vTexCoord).rgb;

    // Transition parameters
    float grassRockHeight = 0.5; float grassRockSharp = 0.5;
    float rockSnowHeight = 1.7; float rockSnowSharp = 0.6;
    float slopeRockThreshold = 0.4; float slopeRockSharp = 0.3; // Start adding rock on slopes > 0.4

    // Subtle noise modulation
    float noiseScale = 10.0; // Adjust scale as needed
    float noiseStrength = 0.1; // Modest strength
    float noise = hash(vTexCoord * noiseScale) * noiseStrength;

    // --- Refined Blending ---
    // 1. Start with base grass color
    vec3 color = grassColor;

    // 2. Blend rock based on height
    float rockAmountHeight = smoothstep(grassRockHeight - grassRockSharp + noise, grassRockHeight + grassRockSharp + noise, height);
    color = mix(color, rockColor, rockAmountHeight);

    // 3. Additively blend more rock based on slope, but only where grass was dominant
    float rockAmountSlope = smoothstep(slopeRockThreshold - slopeRockSharp + noise, slopeRockThreshold + slopeRockSharp + noise, slope);
    color = mix(color, rockColor, rockAmountSlope * (1.0 - rockAmountHeight)); // Only apply slope-rock where height-rock wasn't already fully mixed

    // 4. Blend snow based on height (overrides previous mixes)
    float snowAmount = smoothstep(rockSnowHeight - rockSnowSharp + noise, rockSnowHeight + rockSnowSharp + noise, height);
    color = mix(color, snowColor, snowAmount);
    // --- End Refined Blending ---

    return color;
}

void main() {
    vec3 finalNormal = normalize(vNormal);
    vec3 calculatedBaseColor;
    float alpha = 1.0;

    if (uIsWater) {
        // Apply wave perturbation to the geometric normal for water surface
        float waveFactor1 = sin(vPosition.x * 1.5 + uTime * 0.6) * 0.05;
        float waveFactor2 = cos(vPosition.z * 1.5 + uTime * 0.4) * 0.05;
        finalNormal = normalize(finalNormal + vec3(waveFactor1, 0.0, waveFactor2)); // Apply waves

        // Water base color and sky reflection (unchanged)
        calculatedBaseColor = vec3(0.1, 0.4, 0.7);
        float waterPattern = sin(vPosition.x * 2.0 + uTime * 1.0) * cos(vPosition.z * 2.0 + uTime * 0.7) * 0.02;
        calculatedBaseColor += vec3(waterPattern * 0.5, waterPattern * 0.5, waterPattern);
        float fresnelFactor = pow(1.0 - max(dot(finalNormal, normalize(uCameraPosition - vPosition)), 0.0), 4.5);
        vec3 skyColor = vec3(0.6, 0.75, 0.9);
        calculatedBaseColor = mix(calculatedBaseColor, skyColor, fresnelFactor * 0.75);
        alpha = 0.80;
    } else { // Terrain
        calculatedBaseColor = blendTerrainTextures(finalNormal); // Blend color textures

        // --- Shoreline Foam REMOVED ---

    }

    // --- Use finalNormal (geometric or waved) for all lighting calculations ---
    vec3 lightDirection = normalize(uLightPosition - vPosition);
    vec3 viewDirection = normalize(uCameraPosition - vPosition);
    vec3 reflectionDirection = reflect(-lightDirection, finalNormal);

    vec3 ambient = uAmbientColor;
    float diffuseFactor = max(dot(finalNormal, lightDirection), 0.0);
    vec3 diffuse = diffuseFactor * uDiffuseColor;
    float specularFactor = pow(max(dot(viewDirection, reflectionDirection), 0.0), uShininess);
    vec3 specular = specularFactor * uSpecularColor;

    if (uIsWater) {
        float fresnelFactor = pow(1.0 - max(dot(finalNormal, viewDirection), 0.0), 4.5);
        specular *= fresnelFactor * 1.5;
    }

    vec3 finalColor = calculatedBaseColor * (ambient + diffuse) + specular;

    finalColor = pow(finalColor, vec3(0.8)); // Gamma correction

    fragColor = vec4(finalColor, alpha);
}
`;


function resizeCanvas() {
    const canvas = document.querySelector("#glCanvas");
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    gl.viewport(0, 0, canvas.width, canvas.height);
    aspect = canvas.width / canvas.height;
}

// Function to determine which chunks should be loaded/unloaded
function manageChunks() {
    const chunkWorldSize = CHUNK_SIZE_QUADS * QUAD_SIZE;

    // Calculate the camera's current chunk coordinates
    const cameraChunkX = Math.floor(cameraPosition[0] / chunkWorldSize);
    const cameraChunkY = Math.floor(cameraPosition[2] / chunkWorldSize); // Use Z for chunk Y coordinate

    let requiredChunks = new Set();

    // Determine required chunks within render distance
    for (let dx = -RENDER_DISTANCE_CHUNKS; dx <= RENDER_DISTANCE_CHUNKS; dx++) {
        for (let dy = -RENDER_DISTANCE_CHUNKS; dy <= RENDER_DISTANCE_CHUNKS; dy++) {
            // Optional: Use circular distance instead of square
            // if (dx*dx + dy*dy > RENDER_DISTANCE_CHUNKS * RENDER_DISTANCE_CHUNKS) continue;

            const chunkX = cameraChunkX + dx;
            const chunkY = cameraChunkY + dy;
            requiredChunks.add(`${chunkX}_${chunkY}`);
        }
    }

    // Unload chunks that are no longer required
    for (const chunkKey of activeChunks.keys()) {
        if (!requiredChunks.has(chunkKey)) {
            const chunk = activeChunks.get(chunkKey);
            // Clean up WebGL buffers
            if (chunk.vertexBuffer) gl.deleteBuffer(chunk.vertexBuffer);
            if (chunk.normalBuffer) gl.deleteBuffer(chunk.normalBuffer);
            if (chunk.texCoordBuffer) gl.deleteBuffer(chunk.texCoordBuffer);
            if (chunk.indexBuffer) gl.deleteBuffer(chunk.indexBuffer);
            activeChunks.delete(chunkKey);
            // console.log("Unloaded chunk:", chunkKey);
        }
    }

    // Load new chunks that are required but not active
    for (const chunkKey of requiredChunks) {
        if (!activeChunks.has(chunkKey)) {
            const [chunkX, chunkY] = chunkKey.split('_').map(Number);
            createSingleChunk(chunkX, chunkY);
            // console.log("Loading chunk:", chunkKey);
        }
    }
}

// Function to create geometry and buffers for a single chunk
function createSingleChunk(chunkX, chunkY) {
    const chunkWorldSize = CHUNK_SIZE_QUADS * QUAD_SIZE;
    const chunkKey = `${chunkX}_${chunkY}`;

    // Calculate the world offset for this chunk
    const xOffset = chunkX * chunkWorldSize;
    const zOffset = chunkY * chunkWorldSize; // Use chunkY for Z

    let vertices = [];
    let normals = [];
    let texCoords = [];
    let indices = [];
    let minBounds = [Infinity, Infinity, Infinity];
    let maxBounds = [-Infinity, -Infinity, -Infinity];
    const uvScale = 4.0; // Texture scaling factor

    // Create vertices for this chunk
    for (let y = 0; y <= CHUNK_SIZE_QUADS; y++) {
        for (let x = 0; x <= CHUNK_SIZE_QUADS; x++) {
            const worldX = xOffset + x * QUAD_SIZE;
            const worldZ = zOffset + y * QUAD_SIZE; // Use local y for Z
            const height = terrainHeight(worldX, worldZ);

            vertices.push(worldX, height, worldZ);

            // Update bounding box
            minBounds[0] = Math.min(minBounds[0], worldX);
            minBounds[1] = Math.min(minBounds[1], height);
            minBounds[2] = Math.min(minBounds[2], worldZ);
            maxBounds[0] = Math.max(maxBounds[0], worldX);
            maxBounds[1] = Math.max(maxBounds[1], height);
            maxBounds[2] = Math.max(maxBounds[2], worldZ);

            texCoords.push(worldX / uvScale, worldZ / uvScale);

            // Calculate normal (same method as before)
            const epsilon = 0.01; // Small offset for finite difference normal calculation
            let dzdx = (terrainHeight(worldX + epsilon, worldZ) - height) / epsilon;
            let dzdz = (terrainHeight(worldX, worldZ + epsilon) - height) / epsilon;
            let normal = normalize([-dzdx, 1, -dzdz]);
            normals.push(normal[0], normal[1], normal[2]);
        }
    }

    // Generate indices for this chunk (local vertex indices)
    for (let y = 0; y < CHUNK_SIZE_QUADS; y++) {
        for (let x = 0; x < CHUNK_SIZE_QUADS; x++) {
            let i1 = x + y * (CHUNK_SIZE_QUADS + 1);
            let i2 = (x + 1) + y * (CHUNK_SIZE_QUADS + 1);
            let i3 = x + (y + 1) * (CHUNK_SIZE_QUADS + 1);
            let i4 = (x + 1) + (y + 1) * (CHUNK_SIZE_QUADS + 1);

            indices.push(i1, i3, i2);
            indices.push(i2, i3, i4);
        }
    }

    // Create chunk object, but initially without buffers
    const chunk = {
        cx: chunkX,
        cy: chunkY,
        vertices: new Float32Array(vertices),
        normals: new Float32Array(normals),
        texCoords: new Float32Array(texCoords),
        indices: new Uint16Array(indices),
        boundingBox: { min: minBounds, max: maxBounds },
        vertexBuffer: null, // Buffers will be created shortly
        normalBuffer: null,
        texCoordBuffer: null,
        indexBuffer: null,
        isBuffered: false // Flag to track buffer status
    };

    // Add chunk to map *before* creating buffers (in case creation is async/delayed)
    activeChunks.set(chunkKey, chunk);

    // --- Buffer Creation ---
    // Create and buffer data immediately (can be moved to a separate function or web worker later)
    chunk.vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, chunk.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, chunk.vertices, gl.STATIC_DRAW);

    chunk.normalBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, chunk.normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, chunk.normals, gl.STATIC_DRAW);

    chunk.texCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, chunk.texCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, chunk.texCoords, gl.STATIC_DRAW);

    chunk.indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, chunk.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, chunk.indices, gl.STATIC_DRAW);

    chunk.isBuffered = true; // Mark as buffered
    // --- End Buffer Creation ---
}

// --- Frustum Culling Helpers ---

// Extract frustum planes from the combined view-projection matrix
function extractFrustumPlanes(vpMatrix) {
    let planes = [];
    let m = vpMatrix; // Alias for brevity

    // Normalize plane function: ax + by + cz + d = 0
    const normalizePlane = (plane) => {
        let len = Math.sqrt(plane[0]*plane[0] + plane[1]*plane[1] + plane[2]*plane[2]);
        // Avoid division by zero if length is very small
        if (len < 0.00001) return [0, 0, 0, 0];
        return [plane[0]/len, plane[1]/len, plane[2]/len, plane[3]/len];
    };

    // Left plane:   column 4 + column 1
    planes.push(normalizePlane([m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]]));
    // Right plane:  column 4 - column 1
    planes.push(normalizePlane([m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]]));
    // Bottom plane: column 4 + column 2
    planes.push(normalizePlane([m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]]));
    // Top plane:    column 4 - column 2
    planes.push(normalizePlane([m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]]));
    // Near plane:   column 4 + column 3
    planes.push(normalizePlane([m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]]));
    // Far plane:    column 4 - column 3
    planes.push(normalizePlane([m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]]));

    return planes;
}

// Check if an Axis-Aligned Bounding Box (AABB) intersects the view frustum
function intersectFrustumAABB(planes, box) {
    // Check box against all 6 planes
    for (let i = 0; i < 6; i++) {
        let plane = planes[i];
        // Calculate the signed distance from the center of the box to the plane
        const centerX = (box.min[0] + box.max[0]) * 0.5;
        const centerY = (box.min[1] + box.max[1]) * 0.5;
        const centerZ = (box.min[2] + box.max[2]) * 0.5;
        const dist = plane[0] * centerX + plane[1] * centerY + plane[2] * centerZ + plane[3];

        // Calculate the projection radius of the box onto the plane normal
        const extentX = (box.max[0] - box.min[0]) * 0.5;
        const extentY = (box.max[1] - box.min[1]) * 0.5;
        const extentZ = (box.max[2] - box.min[2]) * 0.5;
        const radius = extentX * Math.abs(plane[0]) + extentY * Math.abs(plane[1]) + extentZ * Math.abs(plane[2]);

        // If the center is further away from the plane than the radius (in the negative direction), the box is entirely outside the plane.
        if (dist < -radius) {
            return false; // Outside this plane, so outside the frustum
        }
    }

    // If the box wasn't fully outside any single plane, it must be intersecting or inside
    return true;
}

// --- End Frustum Culling Helpers ---

function terrainHeight(x, y) {
    // Use fractal noise (multiple octaves of noise) for more interesting terrain
    let height = 0;
    let amplitude = noiseAmplitude;
    let frequency = noiseScale;

    // Apply multiple octaves of noise (fractal Brownian motion)
    for (let i = 0; i < noiseOctaves; i++) {
        // Get noise value at this frequency
        let noiseValue = noise2D(x * frequency, y * frequency);

        // Add to height, scaled by current amplitude
        height += noiseValue * amplitude;

        // Prepare for next octave
        amplitude *= noisePersistence;
        frequency *= 2; // Double frequency each octave
    }

    // Apply flatness factor (higher values = flatter terrain)
    // This reduces the extremes by applying a curve to the height values
    if (terrainFlatness > 0) {
        // Apply a power curve based on flatness (1 = linear, >1 = flatter)
        let flatnessFactor = 1 + terrainFlatness * 2; // Range 1-3
        let sign = Math.sign(height);
        height = sign * Math.pow(Math.abs(height), 1 / flatnessFactor);
    }

    // Add a slight offset to raise the overall terrain slightly
    height += 0.2 + terrainOffset;

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

// Function to load terrain textures (Color maps only)
function loadTerrainTextures() {
    grassTexture = loadTexture('grass.jpg'); // Use local filename
    rockTexture = loadTexture('rock.jpg');   // Use local filename
    snowTexture = loadTexture('snow.jpg');   // Use local filename
}

// Helper function to load a texture
function loadTexture(url) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);

    // Placeholder pixel
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 255, 255]));

    const image = new Image();
    image.src = url;
    image.onload = function() {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        // Apply Anisotropic Filtering if available - Use MAX level
        if (anisotropyExt) {
            const maxAnisotropy = gl.getParameter(anisotropyExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
            // Use the maximum available anisotropy level
            gl.texParameterf(gl.TEXTURE_2D, anisotropyExt.TEXTURE_MAX_ANISOTROPY_EXT, maxAnisotropy);
            // console.log(`Applied Anisotropy Level: ${maxAnisotropy} to ${url}`);
        } else {
            //console.log(`Anisotropy not available for ${url}`);
        }
    };
    image.onerror = function() {
        console.error("Failed to load texture:", url);
    }
    return texture;
}

window.onload = main;
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

    // Update terrain seed information
    const seedElement = document.getElementById('seed');
    if (seedElement) {
        seedElement.textContent = `Terrain Seed: ${Math.floor(terrainSeed)}`;
    }
}
