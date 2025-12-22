import {useRef, useEffect, useState} from 'react'

import './App.css';

interface Device {
  kind: MediaDeviceKind;
  label: string;
  deviceId: string;
}

interface ZoomCapabilities {
  zoom?: {
    min: number;
    max: number;
    step: number;
  };
}

type FacingMode = 'user' | 'environment';

const isMobileDevice = (): boolean => {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
         (window.matchMedia && window.matchMedia('(max-width: 768px)').matches) ||
         ('ontouchstart' in window || navigator.maxTouchPoints > 0);
};

function App() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [devices, setDevices] = useState<Device[]>([])
  const [currentFacingMode, setCurrentFacingMode] = useState<FacingMode>(() => 
    isMobileDevice() ? 'user' : 'environment'
  )
  const [currentZoom, setCurrentZoom] = useState<number>(1)
  const [zoomCapabilities, setZoomCapabilities] = useState<ZoomCapabilities | null>(null)

  console.log('videoRef:', videoRef)

  const getDevices = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        console.error('enumerateDevices не поддерживается');

        return;
      }

      await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      
      const deviceList = await navigator.mediaDevices.enumerateDevices();
      console.log('Доступные устройства:', deviceList);
      
      const formattedDevices = deviceList.map(device => ({
        kind: device.kind,
        label: device.label || 'Устройство без названия',
        deviceId: device.deviceId
      }));
      
      setDevices(formattedDevices);
      
      const cameras = formattedDevices.filter(d => d.kind === 'videoinput');
      console.log('Доступные камеры:', cameras);
      
    } catch (e) {
      console.error('Ошибка при получении списка устройств:', e);
    }
  }

  // Функция для получения доступных уровней зума
  const getAvailableZoomLevels = () => {
    if (!zoomCapabilities || !zoomCapabilities.zoom) {
      return { 
        available: false, 
        x05: false, 
        x1: true, 
        x2: false, 
        x3: false,
        maxZoom: 1
      };
    }

    const { min, max } = zoomCapabilities.zoom;
    
    return {
      available: true,
      x05: min <= 0.5,
      x1: true,
      x2: max >= 2,
      x3: max >= 3,
      maxZoom: max
    };
  }

  const startCamera = async (facingMode: FacingMode, zoomLevel: number = 1) => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.error('getUserMedia не поддерживается в этом браузере');
        alert('Ваш браузер не поддерживает доступ к камере. Пожалуйста, используйте современный браузер или убедитесь, что сайт открыт по HTTPS.');

        return;
      }

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track: MediaStreamTrack) => track.stop());
      }

      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: facingMode
        } as MediaTrackConstraints
      };

      if (facingMode === 'environment' && zoomLevel !== 1) {
        (constraints.video as MediaTrackConstraints & { zoom?: number }).zoom = zoomLevel;
      }

      const newStream = await navigator.mediaDevices.getUserMedia(constraints);

      const videoTrack = newStream.getVideoTracks()[0];
      
      if (videoTrack && videoTrack.getCapabilities) {
        const capabilities = videoTrack.getCapabilities();
        const zoomCap = (capabilities as MediaTrackCapabilities & { zoom?: { min: number; max: number; step: number } }).zoom;
        
        if (zoomCap && facingMode === 'environment') {
          setZoomCapabilities({ zoom: zoomCap });
          console.log('Zoom capabilities:', zoomCap);
        } else {
          setZoomCapabilities(null);
        }
      }

      if (videoTrack && videoTrack.applyConstraints && facingMode === 'environment' && zoomLevel !== 1) {
        try {
          await videoTrack.applyConstraints({
            zoom: zoomLevel
          } as MediaTrackConstraints);
        } catch (e) {
          console.warn('Не удалось применить зум через applyConstraints:', e);
          try {
            await videoTrack.applyConstraints({
              advanced: [{ zoom: zoomLevel } as MediaTrackConstraintSet]
            } as MediaTrackConstraints);
          } catch (e2) {
            console.warn('Не удалось применить зум через advanced:', e2);
          }
        }
      }

      if (videoRef.current) {
        videoRef.current.srcObject = newStream;
      }
      
      streamRef.current = newStream;
      setCurrentZoom(zoomLevel);
    } catch (e) {
      console.error('Ошибка доступа к камере:', e)
      alert('Не удалось получить доступ к камере. Убедитесь, что вы предоставили разрешение на использование камеры.');
    }
  }

  const switchZoom = async (zoomLevel: number) => {
    if (currentFacingMode === 'environment' && streamRef.current) {
      try {
        const videoTrack = streamRef.current.getVideoTracks()[0];
        if (videoTrack && videoTrack.applyConstraints) {
          try {
            await videoTrack.applyConstraints({
              zoom: zoomLevel
            } as MediaTrackConstraints);
            setCurrentZoom(zoomLevel);

            return;
          } catch (e) {
            console.warn('Не удалось применить зум через applyConstraints, пробуем advanced:', e);
            try {
              await videoTrack.applyConstraints({
                advanced: [{ zoom: zoomLevel } as MediaTrackConstraintSet]
              } as MediaTrackConstraints);
              setCurrentZoom(zoomLevel);

              return;
            } catch (e2) {
              console.warn('Не удалось применить зум, пересоздаём поток:', e2);
            }
          }
        }
        await startCamera('environment', zoomLevel);
      } catch (e) {
        console.error('Ошибка при переключении зума:', e);
      }
    }
  }

  const switchCamera = () => {
    const newFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';

    setCurrentFacingMode(newFacingMode);

    const zoomToUse = newFacingMode === 'environment' ? currentZoom : 1;

    startCamera(newFacingMode, zoomToUse);
  }

  useEffect(() => {
    const initCamera = async () => {
      await getDevices();
      await startCamera(currentFacingMode);
    }

    initCamera();

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track: MediaStreamTrack) => track.stop());
      }
    };
  }, [currentFacingMode])

  const zoomLevels = getAvailableZoomLevels();

  const getZoomButtons = () => {
    if (!zoomLevels.available || currentFacingMode !== 'environment') {
      return [];
    }

    const buttons = [];
    const maxZoom = zoomLevels.maxZoom;
    
    if (zoomLevels.x05) {
      buttons.push({ level: 0.5, label: 'x0.5' });
    }
    
    buttons.push({ level: 1, label: 'x1' });
    
    if (zoomLevels.x2) {
      buttons.push({ level: 2, label: 'x2' });
    } else if (maxZoom > 1) {
      buttons.push({ level: maxZoom, label: `x${maxZoom.toFixed(1)}` });
    }
    
    if (zoomLevels.x3) {
      buttons.push({ level: 3, label: 'x3' });
    } else if (maxZoom > 2 && !zoomLevels.x2) {
      if (buttons.length === 3 && buttons[2].level < 2) {
        buttons.pop();
        buttons.push({ level: maxZoom, label: `x${maxZoom.toFixed(1)}` });
      } else if (maxZoom > 3) {
        buttons.push({ level: maxZoom, label: `x${maxZoom.toFixed(1)}` });
      }
    } else if (maxZoom > 3 && zoomLevels.x2) {
      buttons.push({ level: maxZoom, label: `x${maxZoom.toFixed(1)}` });
    }

    return buttons.slice(0, 4);
  };

  const zoomButtons = getZoomButtons();

  return (
    <div className="App">
      <div style={{ position: 'relative' }}>
        <video ref={videoRef} autoPlay playsInline style={{ width: '100%' }}/>
        {currentFacingMode === 'environment' && zoomLevels.available && zoomButtons.length > 1 && (
          <div className="zoom-buttons-container">
            {zoomButtons.map((btn) => {
              const isActive = Math.abs(currentZoom - btn.level) < 0.1;
              
              return (
                <button
                  key={btn.level}
                  onClick={() => switchZoom(btn.level)}
                  className={`zoom-button ${isActive ? 'active' : ''}`}
                >
                  {btn.label}
                </button>
              );
            })}
          </div>
        )}
        
        <button 
          onClick={switchCamera}
          style={{
            position: 'absolute',
            bottom: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '10px 20px',
            fontSize: '14px',
            backgroundColor: '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
            zIndex: 10,
            whiteSpace: 'nowrap'
          }}
        >
          {currentFacingMode === 'environment' ? '📷 Фронтальная' : '📹 Задняя'}
        </button>
      </div>
      
      <div style={{ padding: '20px', background: '#f5f5f5', marginTop: '20px' }}>
        <h3>Доступные устройства:</h3>
        {devices.length === 0 ? (
          <p>Загрузка устройств...</p>
        ) : (
          <ul>
            {devices.map((device, index) => (
              <li key={index} style={{ marginBottom: '10px' }}>
                <strong>{device.kind === 'videoinput' ? '📹 Камера' : 
                         device.kind === 'audioinput' ? '🎤 Микрофон' : 
                         '🔊 Динамик'}:</strong> {device.label}
                <br />
                <small style={{ color: '#666' }}>ID: {device.deviceId}</small>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default App;
