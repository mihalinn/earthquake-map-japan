const EewManager = (() => {
  let activeEew = null;
  let lastEventId = "";
  let isTestMode = false;
  let testData = null;
  let animationId = null;
  let targetZoom = null;

  // 地震波速度 (km/s)
  const VP = 6.3;
  const VS = 3.5;

  // アニメーション用の一時データ
  let lastUpdateSystemTime = 0;
  let lastDisplayTimeDate = null;
  let smoothOffset = null; // カクつき防止用の補間オフセット

  // 初期化時にテストボタンのイベントを設定
  window.addEventListener('load', () => {
    const testBtn = document.getElementById('test-eew-btn');
    if (testBtn) {
        testBtn.onclick = startTest;
    }
  });

  /**
   * テストモード開始
   */
  function startTest() {
    console.log('[EEW] テストモード開始');
    isTestMode = true;
    
    const now = new Date();
    const origin = new Date(now.getTime() - 5000); // 5秒前発生
    const ts = origin.getFullYear() + 
               String(origin.getMonth() + 1).padStart(2, '0') + 
               String(origin.getDate()).padStart(2, '0') + 
               String(origin.getHours()).padStart(2, '0') + 
               String(origin.getMinutes()).padStart(2, '0') + 
               String(origin.getSeconds()).padStart(2, '0');

    testData = {
      EventID: "TEST_" + Date.now(),
      region_name: "テスト震源 (伊豆半島付近)",
      latitude: "35.0",
      longitude: "139.0",
      depth: "10km",
      magunitude: "6.5",
      calcintensity: "5強",
      origin_time: ts,
      report_num: "テスト",
      is_final: "false"
    };

    setTimeout(() => {
        isTestMode = false;
        testData = null;
        stopAnimation();
        clearEew();
        console.log('[EEW] テストモード終了');
    }, 60000);
  }

  /**
   * EEW情報を取得
   */
  async function update(timestamp, currentDisplayTime) {
    if (isTestMode && testData) {
        handleEewData(testData, currentDisplayTime);
        return;
    }

    try {
      // 1. Wolfx API
      const wolfxData = await fetchWolfxEew();
      if (wolfxData) {
          handleEewData(wolfxData, currentDisplayTime);
          return;
      }

      // 2. 強震モニタ API
      const res = await fetch(`/api/kmoni/eew/${timestamp}`);
      const data = await res.json();

      if (data.result.status === "success" && data.result.message !== "データがありません") {
          handleEewData(data, currentDisplayTime);
          return;
      }

      // データがない場合
      stopAnimation();
      clearEew();
    } catch (e) {
      console.warn("[EEW] 取得エラー:", e);
    }
  }

  /**
   * Wolfx EEWの取得
   */
  async function fetchWolfxEew() {
    try {
      const res = await fetch('/api/wolfx/eew');
      const data = await res.json();
      if (!data || data.isCancel) return null;

      const announced = new Date(data.AnnouncedTime);
      if (Math.abs(Date.now() - announced) > 120000) return null;

      return {
        EventID: data.EventID,
        region_name: data.Hypocenter,
        latitude: data.Latitude.toString(),
        longitude: data.Longitude.toString(),
        depth: data.Depth + "km",
        magunitude: data.Magunitude.toString(),
        calcintensity: data.MaxIntensity,
        origin_time: data.OriginTime.replace(/[\/ :]/g, ''),
        report_num: data.Serial.toString(),
        is_final: data.isFinal ? "true" : "false"
      };
    } catch (e) { return null; }
  }

  /**
   * EEWデータの振り分けとズーム処理
   */
  function handleEewData(data, currentDisplayTime) {
    activeEew = data;
    lastUpdateSystemTime = Date.now();
    lastDisplayTimeDate = parseKmoniTime(currentDisplayTime);

    // 新規地震なら初期ズーム
    if (data.EventID !== lastEventId) {
      lastEventId = data.EventID;
      MapManager.getMap().flyTo({
        center: [parseFloat(data.longitude), parseFloat(data.latitude)],
        zoom: 6.5,
        speed: 1.0,
        curve: 1,
        offset: [0, -80] // 震央を画面中央より80px上に表示
      });
    }

    // UI更新
    updateEewUI(data);

    // アニメーション開始
    if (!animationId) {
      startAnimation();
    }
  }

  function startAnimation() {
    function loop() {
      if (!activeEew) return;

      const now = Date.now();
      const origin = parseTimestamp(activeEew.origin_time);
      
      const targetOffset = lastDisplayTimeDate.getTime() - lastUpdateSystemTime;
      if (smoothOffset === null) smoothOffset = targetOffset;
      smoothOffset += (targetOffset - smoothOffset) * 0.1;

      const elapsedMs = (now + smoothOffset) - origin.getTime();
      const elapsedSec = elapsedMs / 1000;

      if (elapsedSec >= 0) {
        const lat = parseFloat(activeEew.latitude);
        const lon = parseFloat(activeEew.longitude);
        const depth = parseFloat(activeEew.depth.replace('km', '')) || 0;

        const pRadius = Math.sqrt(Math.max(0, Math.pow(VP * elapsedSec, 2) - Math.pow(depth, 2)));
        const sRadius = Math.sqrt(Math.max(0, Math.pow(VS * elapsedSec, 2) - Math.pow(depth, 2)));

        const pWave = createCircleFeature(lon, lat, pRadius);
        const sWave = createCircleFeature(lon, lat, sRadius);
        const hypocenter = {
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [lon, lat] },
            properties: { name: activeEew.region_name }
          }]
        };

        MapManager.updateEew({ hypocenter, pWave, sWave });

        // 画面端判定による滑らかなズームアウト (P波基準)
        const map = MapManager.getMap();
        // 移動中(flyTo中)は自動ズームを行わない
        if (pRadius > 10 && !map.isMoving()) {
          const canvas = map.getCanvas();
          const w = canvas.clientWidth;
          const h = canvas.clientHeight;
          const margin = 60;

          const kmPerDegreeLat = 111.32;
          const kmPerDegreeLon = 111.32 * Math.cos(lat * Math.PI / 180);
          const dLat = pRadius / kmPerDegreeLat;
          const dLon = pRadius / kmPerDegreeLon;

          const pN = map.project([lon, lat + dLat]);
          const pS = map.project([lon, lat - dLat]);
          const pW = map.project([lon - dLon, lat]);
          const pE = map.project([lon + dLon, lat]);

          const isOverflow = (
            pN.y < margin || pS.y > h - margin ||
            pW.x < margin || pE.x > w - margin
          );

          if (isOverflow) {
            // 目標ズームを少し下げる
            targetZoom = (targetZoom || map.getZoom()) - 0.02;
          }
          
          if (targetZoom !== null && targetZoom < map.getZoom()) {
            const nextZoom = map.getZoom() + (targetZoom - map.getZoom()) * 0.05;
            map.setZoom(nextZoom);
          } else {
            targetZoom = null; // 収まっている時はリセット
          }
        }
      }

      animationId = requestAnimationFrame(loop);
    }
    animationId = requestAnimationFrame(loop);
  }

  function stopAnimation() {
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
    activeEew = null;
    targetZoom = null;
  }

  function clearEew() {
    MapManager.updateEew({
      hypocenter: { type: 'FeatureCollection', features: [] },
      pWave: { type: 'FeatureCollection', features: [] },
      sWave: { type: 'FeatureCollection', features: [] }
    });
    document.getElementById('eew-panel').style.display = 'none';
    lastEventId = "";
    targetZoom = null;
  }

  function updateEewUI(data) {
    const panel = document.getElementById('eew-panel');
    panel.style.display = 'block';
    
    const isFinal = data.is_final === "true";
    const reportType = isFinal ? '最終報' : `第 ${data.report_num} 報`;
    
    panel.innerHTML = `
      <div class="eew-title">緊急地震速報 (${reportType})</div>
      <div class="eew-hypo">${data.region_name}</div>
      <div class="eew-detail-row">
        <div class="eew-intensity-badge">
          <span class="eew-intensity-label">最大震度</span>
          <span class="eew-intensity-value">${data.calcintensity}</span>
        </div>
        <div class="eew-mag-depth">
          マグニチュード: M${data.magunitude}<br>
          深さ: ${data.depth}
        </div>
      </div>
    `;
  }

  function createCircleFeature(lon, lat, radiusKm) {
    if (radiusKm <= 0) return { type: 'FeatureCollection', features: [] };
    const points = 64;
    const coords = [];
    const kmPerDegreeLat = 111.32;
    const kmPerDegreeLon = 111.32 * Math.cos(lat * Math.PI / 180);
    for (let i = 0; i < points; i++) {
        const angle = (i / points) * (2 * Math.PI);
        const dx = radiusKm * Math.cos(angle);
        const dy = radiusKm * Math.sin(angle);
        coords.push([lon + (dx / kmPerDegreeLon), lat + (dy / kmPerDegreeLat)]);
    }
    coords.push(coords[0]);
    return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] } }] };
  }

  function parseKmoniTime(str) { return new Date(str.replace(/\//g, '-')); }
  function parseTimestamp(ts) {
    const y = ts.substring(0,4), m = ts.substring(4,6), d = ts.substring(6,8);
    const h = ts.substring(8,10), min = ts.substring(10,12), s = ts.substring(12,14);
    return new Date(`${y}-${m}-${d}T${h}:${min}:${s}`);
  }

  return { update, clearEew };
})();
