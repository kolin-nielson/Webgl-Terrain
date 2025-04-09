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
