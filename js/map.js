/**
 * MapManager - MapLibre GL JS Management
 */
const MapManager = (() => {
  let map;

  /**
   * 地図の初期化
   */
  async function init() {
    console.log('[Map] 初期化開始');

    map = new maplibregl.Map({
      container: 'map',
      style: {
        version: 8,
        sources: {},
        layers: [],
        background: { backgroundColor: '#0e1321' }
      },
      center: CONFIG.MAP.CENTER,
      zoom: CONFIG.MAP.ZOOM,
      dragRotate: false,
      touchPitch: false,
      attributionControl: false
    });

    return new Promise((resolve) => {
      map.on('load', async () => {
        await setupLayers();
        console.log('[Map] 地図ロード完了');
        resolve();
      });
    });
  }

  /**
   * 外部データの取得
   * @param {string} url 
   */
  async function fetchData(url) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      return await res.json();
    } catch (e) {
      console.warn(`[Map] データロード失敗 (${url}):`, e.message);
      return null;
    }
  }

  /**
   * レイヤーセットアップ
   * 重なり順を厳密に管理 (下から上へ)
   */
  async function setupLayers() {
    const [worldRaw, prefRaw, cityRaw, regionRaw] = await Promise.all([
      fetchData('./world.json'),
      fetchData('./pref.geojson'),
      fetchData('./city.json'),
      fetchData('./jma_subdivision.geojson')
    ]);

    // 1. 周辺国
    if (worldRaw) {
      const worldGeo = topojson.feature(worldRaw, worldRaw.objects.countries);
      worldGeo.features = worldGeo.features.filter(d => String(d.id) !== "392");
      map.addSource('world', { type: 'geojson', data: worldGeo });
      map.addLayer({
        id: 'world-layer', type: 'fill', source: 'world',
        paint: { 'fill-color': '#0a0d16', 'fill-outline-color': '#334155' }
      });
    }

    // 2. 都道府県 (塗り)
    if (prefRaw) {
      map.addSource('pref', { type: 'geojson', data: prefRaw });
      map.addLayer({
        id: 'pref-fill', type: 'fill', source: 'pref',
        paint: { 'fill-color': '#111827' }
      });
    }

    // 3. 市町村境界 (ズーム時)
    if (cityRaw) {
      const cityKey = Object.keys(cityRaw.objects)[0];
      const cityGeo = topojson.feature(cityRaw, cityRaw.objects[cityKey]);
      map.addSource('city', { type: 'geojson', data: cityGeo });
      map.addLayer({
        id: 'city-layer', type: 'line', source: 'city',
        minzoom: 6.5,
        paint: { 'line-color': '#4a5568', 'line-width': 0.4 }
      });
    }

    // 4. 情報区域区分 (細分区域)
    if (regionRaw) {
      map.addSource('region', { type: 'geojson', data: regionRaw });
      map.addLayer({
        id: 'region-layer', type: 'line', source: 'region',
        paint: { 'line-color': '#e2e8f0', 'line-width': 0.3, 'line-opacity': 0.4 }
      });
    }

    // 5. 都道府県 (枠線)
    if (prefRaw) {
      map.addLayer({
        id: 'pref-outline', type: 'line', source: 'pref',
        paint: { 'line-color': '#f8fafc', 'line-width': 0.8 }
      });
    }

    // 6. 強震モニタ点 (最前面)
    map.addSource('kmoni-points', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });

    map.addLayer({
      id: 'kmoni-points-layer',
      type: 'circle',
      source: 'kmoni-points',
      paint: {
        'circle-radius': [
          'interpolate', ['linear'], ['zoom'],
          5, ['get', 'size'],
          10, ['*', ['get', 'size'], 2]
        ],
        'circle-color': ['get', 'color'],
        'circle-opacity': 0.9,
        'circle-stroke-width': 0.5,
        'circle-stroke-color': '#0e1321'
      }
    });

    document.getElementById('reset-btn').onclick = resetView;
  }

  /**
   * 観測点データの更新
   * @param {Object} geojson 
   */
  function updateKmoniPoints(geojson) {
    const source = map?.getSource('kmoni-points');
    if (source) {
      source.setData(geojson);
    }
  }

  /**
   * 視点のリセット
   */
  function resetView() {
    if (!map) return;
    map.flyTo({
      center: CONFIG.MAP.CENTER,
      zoom: CONFIG.MAP.ZOOM,
      speed: 1.5,
      curve: 1
    });
  }

  return {
    init,
    updateKmoniPoints,
    resetView,
    getMap: () => map
  };
})();
