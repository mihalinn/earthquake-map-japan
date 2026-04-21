/**
 * EewManager - 緊急地震速報（EEW）描画管理
 */
const EewManager = (() => {
  let lastReportId = "";
  
  // 地震波速度 (km/s)
  const VP = 6.3;
  const VS = 3.5;

  /**
   * EEW情報を取得・表示
   * @param {string} timestamp 
   * @param {string} currentDisplayTime "YYYY/MM/DD HH:mm:ss"
   */
  async function update(timestamp, currentDisplayTime) {
    try {
      const res = await fetch(`/api/kmoni/eew/${timestamp}`);
      const data = await res.json();

      if (data.result.status !== "success" || data.result.message === "データがありません") {
        clearEew();
        return;
      }

      // EEW情報を処理
      processEew(data, currentDisplayTime);
    } catch (e) {
      console.warn("[EEW] 取得エラー:", e);
    }
  }

  /**
   * 描画クリア
   */
  function clearEew() {
    MapManager.updateEew({
      hypocenter: { type: 'FeatureCollection', features: [] },
      pWave: { type: 'FeatureCollection', features: [] },
      sWave: { type: 'FeatureCollection', features: [] }
    });
    // UIの非表示
    document.getElementById('eew-panel').style.display = 'none';
  }

  /**
   * EEWデータの解析とレイヤー更新
   */
  function processEew(data, currentDisplayTime) {
    const lat = parseFloat(data.latitude);
    const lon = parseFloat(data.longitude);
    const depth = parseFloat(data.depth.replace('km', '')) || 0;
    const originTimeStr = data.origin_time; // "YYYYMMDDHHmmss"
    
    // 現在の強震モニタ時刻 (currentDisplayTime) との差分を計算
    const now = parseKmoniTime(currentDisplayTime);
    const origin = parseTimestamp(originTimeStr);
    const elapsedSec = (now - origin) / 1000;

    if (elapsedSec < 0) return; // 未来の地震?

    // 1. 震央マーカー (GeoJSON)
    const hypocenter = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: { name: data.region_name }
      }]
    };

    // 2. P波/S波の円 (GeoJSON)
    // 半径 R = sqrt((V*t)^2 - depth^2)
    const pRadius = Math.sqrt(Math.max(0, Math.pow(VP * elapsedSec, 2) - Math.pow(depth, 2)));
    const sRadius = Math.sqrt(Math.max(0, Math.pow(VS * elapsedSec, 2) - Math.pow(depth, 2)));

    const pWave = createCircleFeature(lon, lat, pRadius);
    const sWave = createCircleFeature(lon, lat, sRadius);

    // 地図更新
    MapManager.updateEew({ hypocenter, pWave, sWave });

    // 3. UIパネルの更新
    updateEewUI(data);
  }

  /**
   * EEW情報をUIに表示
   */
  function updateEewUI(data) {
    const panel = document.getElementById('eew-panel');
    panel.style.display = 'block';
    panel.innerHTML = `
      <div class="eew-title">緊急地震速報 (${data.is_final === "true" ? '最終報' : '第' + data.report_num + '報'})</div>
      <div class="eew-hypo">${data.region_name}</div>
      <div class="eew-info">
        M${data.magunitude} / 深さ${data.depth} / 最大震度 ${data.calcintensity}
      </div>
    `;
  }

  /**
   * 円形ポリゴンの生成 (近似)
   */
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
        coords.push([
            lon + (dx / kmPerDegreeLon),
            lat + (dy / kmPerDegreeLat)
        ]);
    }
    coords.push(coords[0]); // 閉じる

    return {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [coords] }
      }]
    };
  }

  // --- Utility ---
  function parseKmoniTime(str) {
    // "2026/04/22 01:44:41" -> Date
    return new Date(str.replace(/\//g, '-'));
  }

  function parseTimestamp(ts) {
    // "20260422014622" -> Date
    const y = ts.substring(0,4), m = ts.substring(4,6), d = ts.substring(6,8);
    const h = ts.substring(8,10), min = ts.substring(10,12), s = ts.substring(12,14);
    return new Date(`${y}-${m}-${d}T${h}:${min}:${s}`);
  }

  return { update, clearEew };
})();
