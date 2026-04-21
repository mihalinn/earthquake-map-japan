/**
 * KmoniProcessor - 強震モニタ画像解析・更新エンジン
 */
const KmoniProcessor = (() => {
  let observationPoints = [];
  let isRunning = false;
  let timerId = null;
  let lastProcessedTime = ''; // 追加: 前回処理した時刻を記憶

  const canvas = document.getElementById('kmoni-canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const timeDisplay = document.getElementById('kmoni-time');

  /**
   * 初期化: 観測点データの読み込み
   */
  async function init() {
    console.log('[KMoni] 観測点データ読み込み中...');
    try {
      const res = await fetch('./data/obs_points.json');
      observationPoints = await res.json();
      console.log(`[KMoni] ${observationPoints.length} 箇所の観測点をロードしました`);
    } catch (e) {
      console.error('[KMoni] 観測点データの読み込みに失敗しました:', e);
    }
  }

  /**
   * 開始
   */
  function start() {
    if (isRunning) return;
    isRunning = true;
    console.log('[KMoni] 解析ループ開始');
    loop();
  }

  /**
   * 停止
   */
  function stop() {
    isRunning = false;
    if (timerId) clearTimeout(timerId);
    console.log('[KMoni] 解析ループ停止');
  }

  /**
   * メインループ
   */
  async function loop() {
    if (!isRunning) return;

    try {
      // 1. 最新時刻の取得
      const latestRes = await fetch(CONFIG.KMONI_LATEST);
      const latestData = await latestRes.json();
      const ts = latestData.latest_time.replace(/[- \/:]/g, ''); // YYYYMMDDHHmmss

      // 2. 読み込み済みデータの時刻チェック
      const displayTime = latestData.latest_time;
      timeDisplay.innerText = `強震モニタ: ${displayTime}`;

      // 時刻が更新されている場合のみ画像を取得・解析する
      if (displayTime !== lastProcessedTime) {
          lastProcessedTime = displayTime;
          await processImage(ts);
          // 追加: EEW情報の更新
          await EewManager.update(ts, displayTime);
      }

      if (window.UI) window.UI.setConnectionStatus('kmoni', 'connected');
    } catch (e) {
      console.error('[KMoni] ループエラー:', e.message);
      if (window.UI) window.UI.setConnectionStatus('kmoni', 'disconnected');
    }

    timerId = setTimeout(loop, CONFIG.KMONI.UPDATE_INTERVAL);
  }

  /**
   * 画像を取得してキャンバスで解析
   * @param {string} timestamp 
   */
  function processImage(timestamp) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        updateStations(imageData);
        resolve();
      };
      img.onerror = () => reject(new Error('画像ロード失敗'));
      img.src = `${CONFIG.KMONI_REALTIME}${timestamp}`;
    });
  }

  /**
   * 全観測点のピクセル解析と地図更新
   * @param {ImageData} imageData 
   */
  function updateStations(imageData) {
    const pixels = imageData.data;
    const features = [];

    for (let i = 0; i < observationPoints.length; i++) {
        const p = observationPoints[i];
        
        // 必要なデータが揃っているか確認
        if (!p.point || !p.point.center_point || !p.location) continue;

        const x = p.point.center_point.x;
        const y = p.point.center_point.y;
        const lon = p.location.longitude;
        const lat = p.location.latitude;

        // ピクセル座標からRGB値を取得
        const idx = (y * canvas.width + x) * 4;
        const r = pixels[idx];
        const g = pixels[idx + 1];
        const b = pixels[idx + 2];

        // カラーテーブルから震度を取得
        const intensity = KMONI_RGB_LOOKUP.get(`${r},${g},${b}`) ?? -3.0;

        // 表示閾値チェック
        if (intensity >= CONFIG.KMONI.DISPLAY_THRESHOLD) {
            features.push({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [lon, lat] },
                properties: {
                    id: p.code || p.id,
                    name: p.name,
                    intensity: intensity,
                    color: getIntensityColor(intensity),
                    size: getIntensitySize(intensity)
                }
            });
        }
    }

    // MapManagerを通じて地図を更新
    MapManager.updateKmoniPoints({
        type: 'FeatureCollection',
        features: features
    });
  }

  return { init, start, stop };
})();
