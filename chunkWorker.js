// Import Simplex Noise library directly within the worker
import { createNoise2D } from './node_modules/simplex-noise/dist/esm/simplex-noise.js';

let noise2D;
let terrainSeed; // Worker will receive the seed

// Replicate terrainHeight function logic within the worker
function terrainHeight(x, y, params) {
    // Use parameters passed from the main thread
    let height = 0;
    let amplitude = params.noiseAmplitude;
    let frequency = params.noiseScale;

    // Apply multiple octaves of noise (fractal Brownian motion)
    for (let i = 0; i < params.noiseOctaves; i++) {
        let noiseValue = noise2D(x * frequency, y * frequency);
        height += noiseValue * amplitude;
        amplitude *= params.noisePersistence;
        frequency *= 2; 
    }

    // Apply flatness factor
    if (params.terrainFlatness > 0) {
        let flatnessFactor = 1 + params.terrainFlatness * 2;
        let sign = Math.sign(height);
        height = sign * Math.pow(Math.abs(height), 1 / flatnessFactor);
    }

    // Gentle background undulation (can be simplified or passed as param if needed)
    height += Math.sin(x * 0.05 + 3.0) * 0.2; 
    
    // Apply Global Amplitude Multiplier passed from main thread
    height *= params.terrainAmplitudeMultiplier;

    // Add offset passed from main thread
    height += 0.2 + params.terrainOffset;

    return height;
}

// Main message listener for the worker
self.onmessage = function(e) {
    const { 
        chunkX, chunkY, terrainParams, 
        CHUNK_SIZE_QUADS, QUAD_SIZE 
    } = e.data;

    // Initialize noise generator if seed has changed or not initialized
    if (terrainSeed !== terrainParams.terrainSeed || !noise2D) {
        terrainSeed = terrainParams.terrainSeed;
         // Create a seeded random function local to this worker instance
        const seededRandom = function() {
            let seed = terrainSeed; // Use the captured seed
            seed = (seed * 9301 + 49297) % 233280;
            terrainSeed = seed; // Update the seed for the next call within this worker scope if needed
            return seed / 233280;
        };
        noise2D = createNoise2D(seededRandom);
    }

    // --- Geometry Generation Logic (moved from main.js) ---
    const chunkWorldSize = CHUNK_SIZE_QUADS * QUAD_SIZE;
    const xOffset = chunkX * chunkWorldSize;
    const zOffset = chunkY * chunkWorldSize;

    let vertices = [];
    let normals = [];
    let texCoords = [];
    let indices = [];
    let minBounds = [Infinity, Infinity, Infinity];
    let maxBounds = [-Infinity, -Infinity, -Infinity];
    const uvScale = 4.0;

    for (let y = 0; y <= CHUNK_SIZE_QUADS; y++) {
        for (let x = 0; x <= CHUNK_SIZE_QUADS; x++) {
            const worldX = xOffset + x * QUAD_SIZE;
            const worldZ = zOffset + y * QUAD_SIZE;
            const height = terrainHeight(worldX, worldZ, terrainParams); // Pass params

            vertices.push(worldX, height, worldZ);

            minBounds[0] = Math.min(minBounds[0], worldX);
            minBounds[1] = Math.min(minBounds[1], height);
            minBounds[2] = Math.min(minBounds[2], worldZ);
            maxBounds[0] = Math.max(maxBounds[0], worldX);
            maxBounds[1] = Math.max(maxBounds[1], height);
            maxBounds[2] = Math.max(maxBounds[2], worldZ);

            texCoords.push(worldX / uvScale, worldZ / uvScale);

            const epsilon = 0.01;
            let dzdx = (terrainHeight(worldX + epsilon, worldZ, terrainParams) - height) / epsilon;
            let dzdz = (terrainHeight(worldX, worldZ + epsilon, terrainParams) - height) / epsilon;
            
            // Normalize function (simple version)
            let nx = -dzdx, ny = 1, nz = -dzdz;
            const len = Math.sqrt(nx*nx + ny*ny + nz*nz);
            if (len > 0.00001) {
                 nx /= len; ny /= len; nz /= len;
            } else {
                 nx = 0; ny = 1; nz = 0;
            }
            normals.push(nx, ny, nz);
        }
    }

    const vertsPerRow = CHUNK_SIZE_QUADS + 1;
    for (let y = 0; y < CHUNK_SIZE_QUADS; y++) {
        for (let x = 0; x < CHUNK_SIZE_QUADS; x++) {
            let i1 = x + y * vertsPerRow;
            let i2 = (x + 1) + y * vertsPerRow;
            let i3 = x + (y + 1) * vertsPerRow;
            let i4 = (x + 1) + (y + 1) * vertsPerRow;
            indices.push(i1, i3, i2);
            indices.push(i2, i3, i4);
        }
    }
    // --- End Geometry Generation ---

    // Convert to TypedArrays
    const verticesArray = new Float32Array(vertices);
    const normalsArray = new Float32Array(normals);
    const texCoordsArray = new Float32Array(texCoords);
    const indicesArray = new Uint16Array(indices);

    // Post data back to the main thread, marking arrays as transferable
    self.postMessage({
        chunkKey: `${chunkX}_${chunkY}`,
        vertices: verticesArray.buffer,
        normals: normalsArray.buffer,
        texCoords: texCoordsArray.buffer,
        indices: indicesArray.buffer,
        boundingBox: { min: minBounds, max: maxBounds },
        indicesLength: indicesArray.length // Need length for drawElements
    }, [verticesArray.buffer, normalsArray.buffer, texCoordsArray.buffer, indicesArray.buffer]);
}; 