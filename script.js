class LocationTracker {
    constructor() {
        this.socket = io();
        this.map = null;
        this.userMarker = null;
        this.otherMarkers = new Map();
        this.currentPosition = null;
        this.watchId = null;
        this.username = 'Anonymous';
        this.localStream = null;
        this.peerConnections = new Map();
        this.isMicActive = false;
        
        this.init();
    }

    init() {
        this.initMap();
        this.initSocketEvents();
        this.initUI();
        this.requestLocationPermission();
        this.openSettingsModal();
    }

    initMap() {
        this.map = L.map('map').setView([-6.2088, 106.8456], 10); // Default Jakarta
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(this.map);
    }

    initSocketEvents() {
        this.socket.on('user-location', (data) => {
            this.updateUserLocation(data);
        });

        this.socket.on('chat-message', (data) => {
            this.addChatMessage(data);
        });

        this.socket.on('user-disconnected', (userId) => {
            this.removeUserMarker(userId);
            this.removeAudioUser(userId);
        });

        this.socket.on('audio-status-update', (data) => {
            this.updateAudioStatus(data.userId, data.isActive);
        });

        // WebRTC signaling
        this.socket.on('offer', (data) => {
            this.handleOffer(data);
        });

        this.socket.on('answer', (data) => {
            this.handleAnswer(data);
        });

        this.socket.on('ice-candidate', (data) => {
            this.handleIceCandidate(data);
        });
    }

    initUI() {
        // Location controls
        document.getElementById('share-location').addEventListener('click', () => {
            this.startLocationSharing();
        });

        document.getElementById('stop-location').addEventListener('click', () => {
            this.stopLocationSharing();
        });

        // Chat
        document.getElementById('send-message').addEventListener('click', () => {
            this.sendMessage();
        });

        document.getElementById('message-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });

        // Mic toggle
        document.getElementById('mic-toggle').addEventListener('click', () => {
            this.toggleMic();
        });

        // Settings
        document.getElementById('save-settings').addEventListener('click', () => {
            this.saveSettings();
        });
    }

    async requestLocationPermission() {
        if ('permissions' in navigator) {
            try {
                const permission = await navigator.permissions.query({name: 'geolocation'});
                if (permission.state === 'denied') {
                    this.showStatus('Location access denied', 'error');
                }
            } catch (e) {
                console.log('Geolocation permission not supported');
            }
        }
    }

    startLocationSharing() {
        if (!navigator.geolocation) {
            this.showStatus('Geolocation not supported', 'error');
            return;
        }

        this.watchId = navigator.geolocation.watchPosition(
            (position) => {
                const { latitude, longitude, accuracy } = position.coords;
                this.currentPosition = { lat: latitude, lng: longitude, accuracy };
                
                // Update own marker
                if (this.userMarker) {
                    this.userMarker.setLatLng([latitude, longitude]);
                } else {
                    this.userMarker = L.marker([latitude, longitude], {
                        icon: L.divIcon({
                            className: 'custom-marker me',
                            html: '<i class="fas fa-user-circle" style="color:#2563eb;font-size:24px;"></i>',
                            iconSize: [32, 32],
                            iconAnchor: [16, 32]
                        })
                    }).addTo(this.map);
                }

                // Send to server
                this.socket.emit('location-update', {
                    lat: latitude,
                    lng: longitude,
                    accuracy
                });

                this.showStatus('Location shared', 'success');
                this.updateUI('sharing');
            },
            (error) => {
                console.error('Geolocation error:', error);
                this.showStatus('Location access denied', 'error');
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 5000
            }
        );

        document.getElementById('share-location').style.display = 'none';
        document.getElementById('stop-location').style.display = 'flex';
    }

    stopLocationSharing() {
        if (this.watchId) {
            navigator.geolocation.clearWatch(this.watchId);
            this.watchId = null;
        }

        if (this.userMarker) {
            this.map.removeLayer(this.userMarker);
            this.userMarker = null;
        }

        this.showStatus('Location sharing stopped', 'info');
        this.updateUI('stopped');
    }

    updateUserLocation(data) {
        if (data.id === this.socket.id) return;

        if (this.otherMarkers.has(data.id)) {
            this.otherMarkers.get(data.id).setLatLng([data.lat, data.lng]);
        } else {
            const marker = L.marker([data.lat, data.lng], {
                icon: L.divIcon({
                    className: 'custom-marker',
                    html: `<i class="fas fa-user-friends" style="color:#ef4444;font-size:20px;"></i>`,
                    iconSize: [28, 28],
                    iconAnchor: [14, 28]
                })
            }).addTo(this.map);

            marker.bindPopup(`User ${data.id.slice(-4)}`);
            this.otherMarkers.set(data.id, marker);
        }

        this.map.fitBounds([
            this.currentPosition ? [this.currentPosition.lat, this.currentPosition.lng] : [-6.2088, 106.8456],
            [data.lat, data.lng]
        ], { padding: [20, 20] });
    }

    removeUserMarker(userId) {
        if (this.otherMarkers.has(userId)) {
            this.map.removeLayer(this.otherMarkers.get(userId));
            this.otherMarkers.delete(userId);
        }
    }

    sendMessage() {
        const input = document.getElementById('message-input');
        const message = input.value.trim();
        if (message) {
            this.socket.emit('chat-message', message);
            input.value = '';
        }
    }

    addChatMessage(data) {
        const messages = document.getElementById('chat-messages');
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message';
        messageDiv.innerHTML = `
            <div class="message-header">
                <span class="message-username">${data.username}</span>
                <span class="message-time">${new Date(data.timestamp).toLocaleTimeString()}</span>
            </div>
            <div class="message-text">${this.escapeHtml(data.message)}</div>
        `;
        messages.appendChild(messageDiv);
        messages.scrollTop = messages.scrollHeight;
        this.updateOnlineCount();
    }

    async toggleMic() {
        if (!this.isMicActive) {
            try {
                this.localStream = await navigator.mediaDevices.getUserMedia({ 
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true
                    }
                });
                
                this.isMicActive = true;
                this.socket.emit('audio-toggle', true);
                this.updateMicUI(true);
                
                // Create peer connections for all users
                this.updateAudioList();
            } catch (err) {
                console.error('Mic access denied:', err);
                this.showStatus('Microphone access denied', 'error');
            }
        } else {
            if (this.localStream) {
                this.localStream.getTracks().forEach(track => track.stop());
                this.localStream = null;
            }
            
            this.isMicActive = false;
            this.socket.emit('audio-toggle', false);
            this.updateMicUI(false);
        }
    }

    updateMicUI(active) {
        const btn = document.getElementById('mic-toggle');
        const icon = btn.querySelector('i');
        if (active) {
            btn.classList.add('active');
            icon.className = 'fas fa-microphone';
            btn.querySelector('span').textContent = 'Mic On';
        } else {
            btn.classList.remove('active');
            icon.className = 'fas fa-microphone-slash';
            btn.querySelector('span').textContent = 'Mic Off';
        }
    }

    updateAudioStatus(userId, isActive) {
        const audioBtn = document.querySelector(`[data-user="${userId}"]`);
        if (audioBtn) {
            if (isActive) {
                audioBtn.classList.add('active-mic');
            } else {
                audioBtn.classList.remove('active-mic');
            }
        }
    }

    updateAudioList() {
        // Simplified - in real app, maintain user list from socket events
        const audioList = document.getElementById('audio-list');
        audioList.innerHTML = `
            <div class="audio-user" data-user="user1">
                <i class="fas fa-user"></i>
                <span>User 1</span>
                <i class="fas fa-volume-up"></i>
            </div>
            <div class="audio-user" data-user="user2">
                <i class="fas fa-user"></i>
                <span>User 2</span>
                <i class="fas fa-volume-up"></i>
            </div>
        `;
        
        // Add click listeners
        document.querySelectorAll('.audio-user').forEach(btn => {
            btn.addEventListener('click', () => {
                this.toggleListen(btn.dataset.user);
            });
        });
    }

    toggleListen(userId) {
        const btn = document.querySelector(`[data-user="${userId}"]`);
        if (btn.classList.contains('listening')) {
            btn.classList.remove('listening');
            // Stop listening
        } else {
            btn.classList.add('listening');
            // Start listening (WebRTC)
        }
    }

    updateUI(state) {
        const shareBtn = document.getElementById('share-location');
        const stopBtn = document.getElementById('stop-location');
        
        if (state === 'sharing') {
            shareBtn.style.display = 'none';
            stopBtn.style.display = 'flex';
        } else {
            shareBtn.style.display = 'flex';
            stopBtn.style.display = 'none';
        }
    }

    showStatus(message, type = 'info') {
        const status = document.getElementById('location-status');
        status.textContent = message;
        status.className = `status ${type}`;
    }

    openSettingsModal() {
        document.getElementById('username-input').value = this.username;
        document.getElementById('settings-modal').style.display = 'block';
    }

    saveSettings() {
        this.username = document.getElementById('username-input').value || 'Anonymous';
        document.getElementById('username').textContent = this.username;
        this.socket.emit('set-username', this.username);
        document.getElementById('settings-modal').style.display = 'none';
    }

    escapeHtml(text) {
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, m => map[m]);
    }

    updateOnlineCount() {
        const count = document.querySelectorAll('.message').length;
        document.getElementById('online-users').textContent = `${count} messages`;
    }
}

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    new LocationTracker();
});