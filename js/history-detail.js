/**
 * HistoryDetailMap - 地震履歴詳細地図の管理
 */
const HistoryDetailMap = (() => {
  let map = null;
  let epicenterMarker = null;
  let cityCentroids = new Map(); // 地名 -> [lng, lat]
  let isCityCacheReady = false;

  /**
   * 自治体データの重心（近似値）を計算してキャッシュする
   */
  async function prepareCityCache() {
    if (isCityCacheReady) return;
    try {
      const res = await fetch('./city.json');
      const cityRaw = await res.json();
      const cityKey = Object.keys(cityRaw.objects)[0];
      const cityGeo = topojson.feature(cityRaw, cityRaw.objects[cityKey]);

      cityGeo.features.forEach(f => {
        const p = f.properties;
        // 照合用の名前を作成 (例: "札幌市中央区", "横浜市", "中頓別町")
        const name = (p.N03_003 || '') + (p.N03_004 || '');
        const shortName = p.N03_004 || '';
        if (!name && !shortName) return;

        // 重心を計算 (単純なBBox中心)
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        
        const processCoords = (coords) => {
          coords.forEach(pt => {
            if (Array.isArray(pt[0])) {
              processCoords(pt);
            } else {
              if (pt[0] < minX) minX = pt[0];
              if (pt[0] > maxX) maxX = pt[0];
              if (pt[1] < minY) minY = pt[1];
              if (pt[1] > maxY) maxY = pt[1];
            }
          });
        };

        if (f.geometry.type === 'Polygon') processCoords(f.geometry.coordinates);
        else if (f.geometry.type === 'MultiPolygon') processCoords(f.geometry.coordinates);

        if (minX !== Infinity) {
          const center = [(minX + maxX) / 2, (minY + maxY) / 2];
          
          // キャッシュ登録 (優先度順)
          if (name && !cityCentroids.has(name)) cityCentroids.set(name, center);
          if (shortName && !cityCentroids.has(shortName)) cityCentroids.set(shortName, center);
          
          // 都道府県+名でも引けるようにしておく
          cityCentroids.set(p.N03_001 + name, center);
          cityCentroids.set(p.N03_001 + shortName, center);
        }
      });
      isCityCacheReady = true;
      console.log(`[HistoryDetailMap] City cache prepared: ${cityCentroids.size} entries`);
    } catch (e) {
      console.error('[HistoryDetailMap] Failed to prepare city cache:', e);
    }
  }

  /**
   * P2P地震情報の震度値をJMA震度文字列に変換
   */
  function p2pScaleToJma(scale) {
    const mapping = {
      10: '1', 20: '2', 30: '3', 40: '4',
      45: '5-', 50: '5+', 55: '6-', 60: '6+', 70: '7'
    };
    return mapping[scale] || String(scale);
  }

  /**
   * 地図の初期化
   */
  async function init() {
    if (map) return;

    await prepareCityCache();

    map = new maplibregl.Map({
      container: 'history-detail-map',
      style: {
        version: 8,
        sources: {},
        layers: [
          {
            id: 'background',
            type: 'background',
            paint: { 'background-color': '#0e1321' }
          }
        ]
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
   * レイヤーセットアップ
   */
  async function setupLayers() {
    try {
      const fetchData = async (url) => {
        const res = await fetch(url);
        return await res.json();
      };

      const [worldRaw, prefRaw, cityRaw] = await Promise.all([
        fetchData('./world.json'),
        fetchData('./pref.geojson'),
        fetchData('./city.json')
      ]);

      // 1. 周辺国
      const worldGeo = topojson.feature(worldRaw, worldRaw.objects.countries);
      worldGeo.features = worldGeo.features.filter(d => String(d.id) !== "392");
      map.addSource('world', { type: 'geojson', data: worldGeo });
      map.addLayer({
        id: 'world-layer', type: 'fill', source: 'world',
        paint: { 'fill-color': '#0a0d16', 'fill-outline-color': '#334155' }
      });

      // 2. 都道府県
      map.addSource('pref', { type: 'geojson', data: prefRaw });
      map.addLayer({
        id: 'pref-fill', type: 'fill', source: 'pref',
        paint: { 'fill-color': '#111827' }
      });
      map.addLayer({
        id: 'pref-line', type: 'line', source: 'pref',
        paint: { 'line-color': '#4a5568', 'line-width': 1 }
      });

      // 3. 市町村境界
      const cityKey = Object.keys(cityRaw.objects)[0];
      const cityGeo = topojson.feature(cityRaw, cityRaw.objects[cityKey]);
      map.addSource('city', { type: 'geojson', data: cityGeo });
      map.addLayer({
        id: 'city-layer', type: 'line', source: 'city',
        minzoom: 6,
        paint: { 'line-color': '#2d3748', 'line-width': 0.4 }
      });

      // 4. 震度分布用ソース
      map.addSource('intensity-points', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      // 震度ドットレイヤー
      map.addLayer({
        id: 'intensity-circles',
        type: 'circle',
        source: 'intensity-points',
        paint: {
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            4, 3,
            7, 8,
            12, 16
          ],
          'circle-color': ['get', 'color'],
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': 1.0
        }
      });
    } catch (e) {
      console.error('[HistoryDetailMap] Layer setup failed:', e);
    }
  }

  function getIntensityColor(scaleStr) {
    const colors = {
      '1': '#4a5568',
      '2': '#2b6cb0',
      '3': '#2f855a',
      '4': '#ecc94b',
      '5-': '#ed8936',
      '5+': '#e53e3e',
      '6-': '#9b2c2c',
      '6+': '#702459',
      '7': '#4a128c'
    };
    return colors[scaleStr] || '#a0aec0';
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

      const lat = parseFloat(item.latitude || item.lat);
      const lng = parseFloat(item.longitude || item.lng);

      if (isNaN(lat) || isNaN(lng)) return;

      // 震央マーカー
      if (epicenterMarker) epicenterMarker.remove();
      const el = document.createElement('div');
      el.innerHTML = '<div style="color: #ff0000; font-size: 32px; font-weight: bold; text-shadow: 0 0 4px rgba(0,0,0,0.8); transform: translate(-50%, -50%);">×</div>';
      
      epicenterMarker = new maplibregl.Marker({ element: el })
        .setLngLat([lng, lat])
        .addTo(map);

      map.flyTo({ center: [lng, lat], zoom: 7, speed: 1.5 });
    },

    /**
     * 各地の震度データを地図に反映する
     */
    updatePoints: (points) => {
      if (!map || !points) return;

      const features = [];
      points.forEach(p => {
        let coords = null;
        
        // 都道府県名を除去した地点名 (例: "青森県五戸町古舘" -> "五戸町古舘")
        const addrWithoutPref = p.pref ? p.addr.replace(p.pref, '') : p.addr;

        // キャッシュから最適な座標を探す
        // 1. 完全一致/前方一致 (地名 -> 座標)
        // cityCentroids には "郡+市区町村" と "市区町村" の両方が入っている
        for (let [cityName, c] of cityCentroids) {
          if (p.addr.startsWith(cityName) || addrWithoutPref.startsWith(cityName)) {
            coords = c;
            break;
          }
        }

        if (coords) {
          const jmaScale = p2pScaleToJma(p.scale);
          features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: coords },
            properties: {
              scale: jmaScale,
              color: getIntensityColor(jmaScale)
            }
          });
        }
      });

      const source = map.getSource('intensity-points');
      if (source) {
        source.setData({ type: 'FeatureCollection', features });
      }
    },

    /**
     * 詳細地図を隠す
     */
    hide: () => {
      const container = document.getElementById('history-detail-map');
      if (container) container.style.display = 'none';
      if (epicenterMarker) epicenterMarker.remove();
      
      // 震度ドットをクリア
      const source = map?.getSource('intensity-points');
      if (source) {
        source.setData({ type: 'FeatureCollection', features: [] });
      }
    }
  };
})();
