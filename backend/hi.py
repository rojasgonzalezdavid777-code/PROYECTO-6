import sqlite3
from flask import Flask, request, jsonify
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__)
CORS(app)

DB_PATH = 'pet_tracker.db'

def init_db():
    conn = sqlite3.connect(DB_PATH, timeout=15)
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT UNIQUE, full_name TEXT, hashed_password TEXT)''')
    c.execute('''CREATE TABLE IF NOT EXISTS devices (id INTEGER PRIMARY KEY, name TEXT, device_type TEXT, owner_id INTEGER, FOREIGN KEY(owner_id) REFERENCES users(id))''')
    c.execute('''CREATE TABLE IF NOT EXISTS locations (id INTEGER PRIMARY KEY, device_id INTEGER, lat REAL, lng REAL, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(device_id) REFERENCES devices(id))''')
    c.execute('''CREATE TABLE IF NOT EXISTS pois (id INTEGER PRIMARY KEY, name TEXT UNIQUE, poi_type TEXT, address TEXT, lat REAL, lng REAL)''')
    conn.commit()
    conn.close()

init_db()

def dict_factory(cursor, row):
    d = {}
    for idx, col in enumerate(cursor.description):
        d[col[0]] = row[idx]
    return d

def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = dict_factory
    return conn

@app.route("/register", methods=["POST"])
def register():
    data = request.json
    conn = get_db()
    c = conn.cursor()
    try:
        # Check if exists
        c.execute("SELECT * FROM users WHERE username = ?", (data['username'],))
        if c.fetchone():
            return jsonify({"detail": "Username already registered"}), 400
        
        hashed = generate_password_hash(data['password'])
        c.execute("INSERT INTO users (username, full_name, hashed_password) VALUES (?, ?, ?)", 
                  (data['username'], data.get('full_name', ''), hashed))
        conn.commit()
        user_id = c.lastrowid
        return jsonify({"id": user_id, "username": data['username']})
    finally:
        conn.close()

@app.route("/login", methods=["POST"])
def login():
    data = request.json
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM users WHERE username = ?", (data['username'],))
    user = c.fetchone()
    conn.close()
    
    if not user or not check_password_hash(user['hashed_password'], data['password']):
        return jsonify({"detail": "Incorrect username or password"}), 400
    
    return jsonify({"message": "Success", "user_id": user['id'], "username": user['username']})

@app.route("/devices", methods=["POST"])
def add_device():
    data = request.json
    owner_id = request.args.get('owner_id')
    conn = get_db()
    c = conn.cursor()
    c.execute("INSERT INTO devices (name, device_type, owner_id) VALUES (?, ?, ?)", 
              (data['name'], data['device_type'], owner_id))
    conn.commit()
    device_id = c.lastrowid
    conn.close()
    return jsonify({"id": device_id, "name": data['name'], "device_type": data['device_type'], "owner_id": owner_id})

@app.route("/devices/<int:owner_id>", methods=["GET"])
def get_devices(owner_id):
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM devices WHERE owner_id = ?", (owner_id,))
    devices = c.fetchall()
    conn.close()
    return jsonify([{k: v for k, v in dict(d).items()} for d in devices])

@app.route("/locations", methods=["POST"])
def add_location():
    data = request.json
    conn = get_db()
    c = conn.cursor()
    c.execute("INSERT INTO locations (device_id, lat, lng) VALUES (?, ?, ?)", 
              (data['device_id'], data['lat'], data['lng']))
    conn.commit()
    loc_id = c.lastrowid
    conn.close()
    return jsonify({"id": loc_id, "lat": data['lat'], "lng": data['lng']})

@app.route("/locations/<int:device_id>", methods=["GET"])
def get_locations(device_id):
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM locations WHERE device_id = ? ORDER BY timestamp ASC", (device_id,))
    locs = c.fetchall()
    conn.close()
    return jsonify([dict(l) for l in locs])

@app.route("/locations/latest/<int:device_id>", methods=["GET"])
def get_latest_location(device_id):
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM locations WHERE device_id = ? ORDER BY timestamp DESC LIMIT 1", (device_id,))
    loc = c.fetchone()
    conn.close()
    if not loc:
        return jsonify({}), 404
    return jsonify(dict(loc))

@app.route("/pois", methods=["GET"])
def get_pois():
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM pois")
    pois = c.fetchall()
    conn.close()
    return jsonify([dict(p) for p in pois])

@app.route("/seed_pois", methods=["POST"])
def seed_pois():
    conn = get_db()
    c = conn.cursor()
    initial_pois = [
        {"name": "Comisaría 1ra", "poi_type": "police", "address": "Av. Principal 123", "lat": 4.6097, "lng": -74.0817},
        {"name": "Veterinaria San Roque", "poi_type": "vet", "address": "Calle Falsa 456", "lat": 4.6120, "lng": -74.0850},
        {"name": "Fiscalía General", "poi_type": "fiscalia", "address": "Av. Las Americas 789", "lat": 4.6050, "lng": -74.0800}
    ]
    for poi in initial_pois:
        c.execute("SELECT id FROM pois WHERE name = ?", (poi['name'],))
        if not c.fetchone():
            c.execute("INSERT INTO pois (name, poi_type, address, lat, lng) VALUES (?, ?, ?, ?, ?)", 
                      (poi['name'], poi['poi_type'], poi['address'], poi['lat'], poi['lng']))
    conn.commit()
    conn.close()
    return jsonify({"message": "POIs seeded"})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=True)
