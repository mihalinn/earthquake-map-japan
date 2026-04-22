/**
 * HistoryDetailMap - 地震履歴詳細地図の管理
 */
const HistoryDetailMap = (() => {
  let map;
  let epicenterMarker;

  /**
   * 地図の初期化
   */
  async function init() {
    if (map) return;

    map = new maplibregl.Map({
      container: 'history-detail-map',
      style: {
        version: 8,
        sources: {},
        layers: [],
        background: { backgroundColor: '#0e1321' }
      },
      center: CONFIG.MAP.CENTER,
      zoom: 6,
      dragRotate: false,
      touchPitch: false,
      attributionControl: false
    });

    return new Promise((resolve) => {
      map.on('load', async () => {
        await setupLayers();
        resolve();
      });
    });
  }

  /**
   * レイヤーセットアップ (メイン地図と同じデータを使用)
   */
  async function setupLayers() {
    const fetchData = async (url) => {
      const res = await fetch(url);
      return await res.json();
    };

    const [worldRaw, prefRaw, cityRaw] = await Promise.all([
      fetchData('./world.json'),
      fetchData('./pref.geojson'),
      fetchData('./city.json')
    ]);

    // 1. 周辺国 (TopoJSON)
    if (worldRaw) {
      const worldGeo = topojson.feature(worldRaw, worldRaw.objects.countries);
      worldGeo.features = worldGeo.features.filter(d => String(d.id) !== "392");
      map.addSource('world', { type: 'geojson', data: worldGeo });
      map.addLayer({
        id: 'world-layer', type: 'fill', source: 'world',
        paint: { 'fill-color': '#0a0d16', 'fill-outline-color': '#334155' }
      });
    }

    // 2. 都道府県 (GeoJSON)
    if (prefRaw) {
      map.addSource('pref', { type: 'geojson', data: prefRaw });
      map.addLayer({
        id: 'pref-fill', type: 'fill', source: 'pref',
        paint: { 'fill-color': '#111827' }
      });
      map.addLayer({
        id: 'pref-line', type: 'line', source: 'pref',
        paint: { 'line-color': '#4a5568', 'line-width': 0.8 }
      });
    }

    // 3. 市町村境界 (TopoJSON)
    if (cityRaw) {
      const cityKey = Object.keys(cityRaw.objects)[0];
      const cityGeo = topojson.feature(cityRaw, cityRaw.objects[cityKey]);
      map.addSource('city', { type: 'geojson', data: cityGeo });
      map.addLayer({
        id: 'city-layer', type: 'line', source: 'city',
        minzoom: 6,
        paint: { 'line-color': '#2d3748', 'line-width': 0.4 }
      });
    }
  }

  return {
    /**
     * 詳細地図の表示
     */
    show: async (item) => {
      const container = document.getElementById('history-detail-map');
      if (!container) return;
      container.style.display = 'block';

      if (!map) {
        await init();
      } else {
        map.resize();
      }

      const lat = parseFloat(item.latitude);
      const lng = parseFloat(item.longitude);

      if (isNaN(lat) || isNaN(lng)) return;

      // 震央マーカーの作成 (単純なHTML要素)
      if (epicenterMarker) epicenterMarker.remove();
      
      const el = document.createElement('div');
      el.innerHTML = '<div style="color: #ff0000; font-size: 30px; font-weight: bold; transform: translate(-50%, -50%);">×</div>';
      
      epicenterMarker = new maplibregl.Marker({ element: el })
        .setLngLat([lng, lat])
        .addTo(map);

      // 移動
      map.flyTo({
        center: [lng, lat],
        zoom: 7,
        speed: 1.5,
        essential: true
      });
    },

    /**
     * 詳細地図を隠す
     */
    hide: () => {
      const container = document.getElementById('history-detail-map');
      if (container) container.style.display = 'none';
      if (epicenterMarker) epicenterMarker.remove();
    }
  };
})();
