const API_URL = 'http://localhost:8000';
let map;
let currentUser = null;
let currentDevice = null;
let deviceMarkers = {};
let poiMarkers = [];
let routePolyline = null;
let simulationInterval = null;

// Initialize Map
function initMap() {
    map = L.map('map', {zoomControl: false}).setView([4.6097, -74.0817], 13); // Default Bogota
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
}

document.addEventListener('DOMContentLoaded', () => {
    initMap();

    const authForm = document.getElementById('auth-form');
    const authSection = document.getElementById('auth-section');
    const dashboardSection = document.getElementById('dashboard-section');
    const msgEl = document.getElementById('auth-msg');

    // Registration
    document.getElementById('btn-register').addEventListener('click', async () => {
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        if (!username || !password) return msgEl.innerText = "Por favor ingresa datos";

        try {
            const res = await fetch(`${API_URL}/register`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({username, password, full_name: username})
            });
            const data = await res.json();
            if (res.ok) {
                msgEl.innerText = "Registro exitoso. Ahora inicia sesión.";
                msgEl.style.color = "var(--accent)";
            } else {
                msgEl.innerText = data.detail || "Error en registro";
            }
        } catch (err) {
            msgEl.innerText = "Error de conexión";
        }
    });

    // Login
    authForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        
        try {
            const res = await fetch(`${API_URL}/login`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({username, password})
            });
            const data = await res.json();
            if (res.ok) {
                currentUser = data;
                authSection.classList.add('hidden');
                dashboardSection.classList.remove('hidden');
                document.getElementById('user-display-name').innerText = currentUser.username;
                loadDevices();
            } else {
                msgEl.innerText = data.detail || "Error en login";
            }
        } catch (err) {
            msgEl.innerText = "Error de conexión";
        }
    });

    // Logout
    document.getElementById('btn-logout').addEventListener('click', () => {
        currentUser = null;
        currentDevice = null;
        dashboardSection.classList.add('hidden');
        authSection.classList.remove('hidden');
        if (routePolyline) map.removeLayer(routePolyline);
        Object.values(deviceMarkers).forEach(m => map.removeLayer(m));
        deviceMarkers = {};
    });

    // POIs
    document.getElementById('btn-load-pois').addEventListener('click', async () => {
        await fetch(`${API_URL}/seed_pois`, {method: 'POST'});
        const res = await fetch(`${API_URL}/pois`);
        const data = await res.json();
        
        poiMarkers.forEach(m => map.removeLayer(m));
        poiMarkers = [];
        
        data.forEach(poi => {
            let color = 'blue';
            if(poi.poi_type == 'police') color = 'darkblue';
            if(poi.poi_type == 'vet') color = 'green';
            if(poi.poi_type == 'fiscalia') color = 'red';

            const marker = L.marker([poi.lat, poi.lng]).bindPopup(`<b>${poi.name}</b><br>${poi.address}`).addTo(map);
            poiMarkers.push(marker);
        });
        map.setView([4.6097, -74.0817], 13);
    });

    // Add Device
    document.getElementById('btn-add-device').addEventListener('click', () => {
        const name = prompt("Nombre del Dispositivo (ej. Mi iPhone o Toby):");
        if (!name) return;

        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(async (position) => {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                
                // Create device
                const res = await fetch(`${API_URL}/devices?owner_id=${currentUser.user_id}`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({name: name, device_type: 'cellphone'})
                });
                const device = await res.json();
                
                // Save actual location
                await fetch(`${API_URL}/locations`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({device_id: device.id, lat: lat, lng: lng})
                });
                
                loadDevices();
                map.setView([lat, lng], 17);
                
            }, async (error) => {
                alert("Mostrando en Bogotá. No se detectó GPS real: " + error.message);
                await addDeviceFallback(name);
            });
        } else {
            addDeviceFallback(name);
        }
    });

    async function addDeviceFallback(name) {
        await fetch(`${API_URL}/devices?owner_id=${currentUser.user_id}`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({name: name, device_type: 'cellphone'})
        });
        loadDevices();
    }

    document.getElementById('btn-simulate').addEventListener('click', () => {
        if (!currentDevice) return;
        if (simulationInterval) {
            clearInterval(simulationInterval);
            simulationInterval = null;
            document.getElementById('btn-simulate').innerText = "Simular Movimiento";
            document.getElementById('btn-simulate').classList.add('danger');
            document.getElementById('btn-simulate').classList.remove('primary');
        } else {
            simulateMovement(currentDevice.id);
            document.getElementById('btn-simulate').innerText = "Detener Simulación";
            document.getElementById('btn-simulate').classList.add('primary');
            document.getElementById('btn-simulate').classList.remove('danger');
        }
    });
});

async function loadDevices() {
    const res = await fetch(`${API_URL}/devices/${currentUser.user_id}`);
    const devices = await res.json();
    
    const ul = document.getElementById('devices-ul');
    ul.innerHTML = '';
    
    devices.forEach(dev => {
        const li = document.createElement('li');
        li.className = 'device-item';
        li.innerHTML = `<span>📱 ${dev.name}</span> <span style="font-size:12px;opacity:0.7">Ver Ruta →</span>`;
        li.onclick = () => selectDevice(dev, li);
        ul.appendChild(li);
        
        // Load latest location if any
        fetch(`${API_URL}/locations/latest/${dev.id}`).then(r => r.json()).then(loc => {
            if (loc.lat) {
                if(deviceMarkers[dev.id]) map.removeLayer(deviceMarkers[dev.id]);
                deviceMarkers[dev.id] = L.marker([loc.lat, loc.lng], {
                    icon: L.icon({
                        iconUrl: 'https://cdn-icons-png.flaticon.com/512/684/684908.png', 
                        iconSize: [32, 32]
                    })
                }).bindPopup(`<b>${dev.name}</b>`).addTo(map);
            }
        }).catch(e => {});
    });
}

async function selectDevice(dev, element) {
    document.querySelectorAll('.device-item').forEach(el => el.classList.remove('active'));
    element.classList.add('active');
    currentDevice = dev;
    document.getElementById('btn-simulate').classList.remove('hidden');

    const res = await fetch(`${API_URL}/locations/${dev.id}`);
    const history = await res.json();

    if (routePolyline) map.removeLayer(routePolyline);
    
    if (history.length > 0) {
        const latlngs = history.map(h => [h.lat, h.lng]);
        routePolyline = L.polyline(latlngs, {color: 'var(--accent)', weight: 4}).addTo(map);
        map.fitBounds(routePolyline.getBounds());
    } else {
        alert("Sin historial. Inicia simulación para generar datos.");
    }
}

async function simulateMovement(deviceId) {
    let lat = 4.6097;
    let lng = -74.0817;

    try {
        const res = await fetch(`${API_URL}/locations/latest/${deviceId}`);
        if(res.ok) {
            const loc = await res.json();
            if(loc.lat) { lat = loc.lat; lng = loc.lng; }
        }
    } catch(e) {}
    
    simulationInterval = setInterval(async () => {
        lat += (Math.random() * 0.002 - 0.001);
        lng += (Math.random() * 0.002 - 0.001);
        
        await fetch(`${API_URL}/locations`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({device_id: deviceId, lat, lng})
        });

        // Update marker
        if(deviceMarkers[deviceId]) map.removeLayer(deviceMarkers[deviceId]);
        deviceMarkers[deviceId] = L.marker([lat, lng], {
            icon: L.icon({
                iconUrl: 'https://cdn-icons-png.flaticon.com/512/684/684908.png', 
                iconSize: [32, 32]
            })
        }).bindPopup(`<b>Dispositivo</b> ubicacion`).addTo(map);
        
        // Refresh route view if currently selected
        if (currentDevice && currentDevice.id === deviceId) {
            const res = await fetch(`${API_URL}/locations/${deviceId}`);
            const history = await res.json();
            if (routePolyline) map.removeLayer(routePolyline);
            const latlngs = history.map(h => [h.lat, h.lng]);
            routePolyline = L.polyline(latlngs, {color: 'var(--accent)', weight: 4}).addTo(map);
        }
    }, 3000);
}
