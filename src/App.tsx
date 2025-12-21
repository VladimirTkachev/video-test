import {useRef, useEffect, useState} from 'react'

import logo from './logo.svg';
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

// Функция для определения мобильного устройства
const isMobileDevice = (): boolean => {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
         (window.matchMedia && window.matchMedia('(max-width: 768px)').matches) ||
         ('ontouchstart' in window || navigator.maxTouchPoints > 0);
};

function App() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [devices, setDevices] = useState<Device[]>([])
  // На мобильных устройствах по умолчанию фронтальная камера ('user'), на десктопе - задняя ('environment')
  const [currentFacingMode, setCurrentFacingMode] = useState<FacingMode>(() => 
    isMobileDevice() ? 'user' : 'environment'
  )
  const [currentZoom, setCurrentZoom] = useState<number>(1) // Текущий уровень зума
  const [zoomCapabilities, setZoomCapabilities] = useState<ZoomCapabilities | null>(null) // Возможности зума камеры

  console.log('videoRef:', videoRef)

  // Функция для получения списка доступных устройств
  const getDevices = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        console.error('enumerateDevices не поддерживается');
        return;
      }

      // Сначала нужно запросить разрешение, иначе deviceId будет пустым
      await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      
      const deviceList = await navigator.mediaDevices.enumerateDevices();
      console.log('Доступные устройства:', deviceList);
      
      const formattedDevices = deviceList.map(device => ({
        kind: device.kind, // 'videoinput', 'audioinput', 'audiooutput'
        label: device.label || 'Устройство без названия',
        deviceId: device.deviceId
      }));
      
      setDevices(formattedDevices);
      
      // Выводим в консоль отфильтрованные камеры
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
      x05: min <= 0.5,  // x0.5 доступна если минимум <= 0.5
      x1: true,          // x1 всегда доступна
      x2: max >= 2,      // x2 доступна если максимум >= 2
      x3: max >= 3,      // x3 доступна если максимум >= 3
      maxZoom: max       // Максимально возможный зум
    };
  }

  // Функция для запуска камеры
  const startCamera = async (facingMode: FacingMode, zoomLevel: number = 1) => {
    try {
      // Проверка поддержки mediaDevices API
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.error('getUserMedia не поддерживается в этом браузере');
        alert('Ваш браузер не поддерживает доступ к камере. Пожалуйста, используйте современный браузер или убедитесь, что сайт открыт по HTTPS.');
        return;
      }

      // Останавливаем предыдущий поток
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track: MediaStreamTrack) => track.stop());
      }

      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: facingMode
        } as MediaTrackConstraints
      };

      // Добавляем зум только для задней камеры
      if (facingMode === 'environment' && zoomLevel !== 1) {
        (constraints.video as MediaTrackConstraints & { zoom?: number }).zoom = zoomLevel;
      }

      const newStream = await navigator.mediaDevices.getUserMedia(constraints);

      // Получаем capabilities камеры для определения доступных уровней зума
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

      // Применяем зум через applyConstraints (если поток уже создан и нужно изменить зум)
      if (videoTrack && videoTrack.applyConstraints && facingMode === 'environment' && zoomLevel !== 1) {
        try {
          await videoTrack.applyConstraints({
            zoom: zoomLevel
          } as MediaTrackConstraints);
        } catch (e) {
          console.warn('Не удалось применить зум через applyConstraints:', e);
          // Пробуем через advanced
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

  // Функция для переключения зума
  const switchZoom = async (zoomLevel: number) => {
    if (currentFacingMode === 'environment' && streamRef.current) {
      try {
        const videoTrack = streamRef.current.getVideoTracks()[0];
        if (videoTrack && videoTrack.applyConstraints) {
          // Пробуем применить зум к существующему треку
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
        // Если не удалось применить к существующему треку, пересоздаём поток
        await startCamera('environment', zoomLevel);
      } catch (e) {
        console.error('Ошибка при переключении зума:', e);
      }
    }
  }

  // Функция для переключения камеры
  const switchCamera = () => {
    const newFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
    setCurrentFacingMode(newFacingMode);
    // При переключении на фронтальную камеру сбрасываем зум на 1
    const zoomToUse = newFacingMode === 'environment' ? currentZoom : 1;
    startCamera(newFacingMode, zoomToUse);
  }

  useEffect(() => {
    const initCamera = async () => {
      // Получаем список устройств
      await getDevices();
      // Запускаем камеру
      await startCamera(currentFacingMode);
    }

    initCamera();

    // Очистка при размонтировании компонента
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track: MediaStreamTrack) => track.stop());
      }
    };
  }, [])

  const zoomLevels = getAvailableZoomLevels();

  // Определяем, какие кнопки показывать (максимум 4: x0.5, x1, x2/xMax, x3/xMax)
  const getZoomButtons = () => {
    if (!zoomLevels.available || currentFacingMode !== 'environment') {
      return [];
    }

    const buttons = [];
    const maxZoom = zoomLevels.maxZoom;
    
    // 1. x0.5 (слева от x1, если доступна)
    if (zoomLevels.x05) {
      buttons.push({ level: 0.5, label: 'x0.5' });
    }
    
    // 2. x1 (всегда в центре, активная по умолчанию)
    buttons.push({ level: 1, label: 'x1' });
    
    // 3. x2 или максимальный зум (справа от x1)
    if (zoomLevels.x2) {
      buttons.push({ level: 2, label: 'x2' });
    } else if (maxZoom > 1) {
      // Если x2 недоступна, показываем максимально возможный зум вместо неё
      buttons.push({ level: maxZoom, label: `x${maxZoom.toFixed(1)}` });
    }
    
    // 4. x3 или максимальный зум (справа от x2)
    if (zoomLevels.x3) {
      buttons.push({ level: 3, label: 'x3' });
    } else if (maxZoom > 2 && !zoomLevels.x2) {
      // Если x3 недоступна и x2 тоже, но максимум > 2, заменяем предыдущую кнопку на максимум
      if (buttons.length === 3 && buttons[2].level < 2) {
        buttons.pop();
        buttons.push({ level: maxZoom, label: `x${maxZoom.toFixed(1)}` });
      } else if (maxZoom > 3) {
        // Если максимум > 3, добавляем его как отдельную кнопку
        buttons.push({ level: maxZoom, label: `x${maxZoom.toFixed(1)}` });
      }
    } else if (maxZoom > 3 && zoomLevels.x2) {
      // Если x2 доступна, но x3 нет, и максимум > 3, показываем максимум вместо x3
      buttons.push({ level: maxZoom, label: `x${maxZoom.toFixed(1)}` });
    }

    // Ограничиваем максимум 4 кнопками
    return buttons.slice(0, 4);
  };

  const zoomButtons = getZoomButtons();

  return (
    <div className="App">
      <div style={{ position: 'relative' }}>
        <video ref={videoRef} autoPlay playsInline style={{ width: '100%' }}/>
        
        {/* Кнопки зума (только для задней камеры) */}
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
