/**
 * HistoryManager - Wolfx APIを使用した地震履歴管理
 */
const HistoryManager = (() => {
  let historyData = [];

  /**
   * 履歴データの取得
   */
  async function fetchHistory() {
    console.log('[History] 履歴データ取得中...');
    try {
      const res = await fetch('/api/wolfx/eqlist');
      const data = await res.json();

      // Wolfxのレスポンス形式に合わせてパース (No1, No2... 形式を配列に変換)
      historyData = Object.values(data).filter(item => item.location);

      // 時刻順にソート (新しい順)
      historyData.sort((a, b) => new Date(b.time) - new Date(a.time));

      render();
    } catch (e) {
      console.warn('[History] 取得失敗:', e);
      document.getElementById('history-list').innerText = '履歴データの取得に失敗しました';
    }
  }

  /**
   * 詳細情報の表示
   */
  async function showDetail(item) {
    const listView = document.getElementById('history-list-view');
    const detailView = document.getElementById('history-detail-view');
    const content = document.getElementById('history-detail-content');
    
    if (!listView || !detailView || !content) return;

    const intensityClass = getIntensityClass(item.shindo);
    const displayShindo = item.shindo || '不明';

    // まずは基本情報を表示
    content.innerHTML = `
      <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
        <div class="intensity-badge ${intensityClass}" style="width: 36px; height: 36px; font-size: ${displayShindo.length > 1 ? '14px' : '20px'};">${displayShindo}</div>
        <div style="flex: 1;">
          <div style="font-size: 15px; font-weight: bold; color: #fff; line-height: 1.2;">${item.location}</div>
          <div style="font-size: 10px; color: #a0aec0;">${item.time}</div>
        </div>
      </div>

      <div style="display: flex; gap: 8px; margin-bottom: 6px;">
        <div style="flex: 1; background: rgba(255,255,255,0.05); padding: 4px 8px; border-radius: 4px;">
          <span style="font-size: 9px; color: #718096; display: block;">マグニチュード</span>
          <span style="font-size: 13px; font-weight: bold; color: #fff;">M${item.magnitude}</span>
        </div>
        <div style="flex: 1; background: rgba(255,255,255,0.05); padding: 4px 8px; border-radius: 4px;">
          <span style="font-size: 9px; color: #718096; display: block;">震源の深さ</span>
          <span style="font-size: 13px; font-weight: bold; color: #fff;">${item.depth}</span>
        </div>
      </div>

      <div style="font-size: 11px; color: #e2e8f0; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 6px;">
        <div style="margin-bottom: 4px;">
          <span style="color: #718096; margin-right: 4px;">情報:</span>
          <span>${item.info || '津波の心配なし'}</span>
        </div>
      </div>

      <div id="intensity-distribution-area" style="margin-top: 10px; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 8px;">
        <div style="font-size: 10px; color: #718096; margin-bottom: 5px;">各地の震度 (取得中...)</div>
        <div id="intensity-points-list" style="font-size: 11px; color: #cbd5e0;">
          <div class="loading-dots">取得中...</div>
        </div>
      </div>
    `;

    listView.style.display = 'none';
    detailView.style.display = 'flex';

    // 詳細地図の表示
    HistoryDetailMap.show(item);

    // 詳細データをP2P APIから取得して照合
    try {
      const res = await fetch('/api/p2p/history');
      const p2pData = await res.json();
      
      // 時刻でマッチング (Wolfxは YYYY/MM/DD HH:mm 形式)
      const targetTime = item.time.substring(0, 16);
      const match = p2pData.find(p => p.earthquake.time.substring(0, 16) === targetTime);

      const pointsList = document.getElementById('intensity-points-list');
      const distLabel = document.querySelector('#intensity-distribution-area div');

      if (match && match.points) {
        distLabel.innerText = '各地の震度';
        
        // 震度ごとにグループ化
        const grouped = {};
        match.points.forEach(p => {
          const scale = formatScale(p.scale);
          if (!grouped[scale]) grouped[scale] = [];
          grouped[scale].push(p.addr);
        });

        // 震度の強さ順にソートするための重み
        const scaleWeight = {
          '7': 70, '6強': 65, '6弱': 60, '5強': 55, '5弱': 50, '4': 40, '3': 30, '2': 20, '1': 10
        };

        const sortedScales = Object.keys(grouped).sort((a, b) => (scaleWeight[b] || 0) - (scaleWeight[a] || 0));
        
        pointsList.innerHTML = sortedScales.map(scale => `
          <div style="margin-bottom: 8px;">
            <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 3px;">
              <span class="intensity-badge ${getIntensityClass(scale)}" style="width: 20px; height: 20px; font-size: ${scale.length > 1 ? '8px' : '11px'};">${scale}</span>
              <span style="font-weight: bold; color: #edf2f7; font-size: 11px;">震度${scale}</span>
            </div>
            <div style="padding-left: 26px; line-height: 1.4; color: #a0aec0; word-break: break-all;">
              ${grouped[scale].join('、')}
            </div>
          </div>
        `).join('');
      } else {
        pointsList.innerText = '詳細な震度データが見つかりませんでした。';
      }
    } catch (e) {
      console.warn('[History] P2Pデータ取得失敗:', e);
      document.getElementById('intensity-points-list').innerText = '震度データの取得に失敗しました。';
    }
  }

  /**
   * P2PのScale(10, 20...)を一般的な震度文字(1, 2, 3...)に変換
   */
  function formatScale(scale) {
    const map = {
      10: '1', 20: '2', 30: '3', 40: '4', 
      45: '5弱', 50: '5強', 55: '6弱', 60: '6強', 70: '7'
    };
    return map[scale] || (scale / 10).toString();
  }

  /**
   * リスト表示に戻す
   */
  function showList() {
    document.getElementById('history-list-view').style.display = 'flex';
    document.getElementById('history-detail-view').style.display = 'none';
    
    // 詳細地図を隠す
    HistoryDetailMap.hide();
  }

  /**
   * リストの描画
   */
  function render() {
    const listContainer = document.getElementById('history-list');
    if (!listContainer) return;

    if (historyData.length === 0) {
      listContainer.innerText = '履歴がありません';
      return;
    }

    listContainer.innerHTML = ''; // クリア
    listContainer.style.marginTop = '0';
    listContainer.style.textAlign = 'left';

    // 最新50件を表示
    historyData.slice(0, 50).forEach(item => {
      const el = document.createElement('div');
      el.className = 'history-item';

      const intensityClass = getIntensityClass(item.shindo);
      const displayShindo = item.shindo || '不明';

      el.innerHTML = `
        <div class="history-item-left">
          <span class="intensity-badge ${intensityClass}" style="font-size: ${displayShindo.length > 1 ? '10px' : '18px'};">${displayShindo}</span>
        </div>
        <div class="history-item-main">
          <div class="history-item-top">
            <span class="history-hypo">${item.location}</span>
            <span class="history-time">${formatTime(item.time)}</span>
          </div>
          <div class="history-item-bottom">
            M${item.magnitude} / 深さ:${item.depth} / ${item.info || '津波の心配なし'}
          </div>
        </div>
      `;

      // クリックで詳細を表示
      el.onclick = () => {
        showDetail(item);
      };

      listContainer.appendChild(el);
    });
  }

  /**
   * 震度に応じたCSSクラス
   */
  function getIntensityClass(intStr) {
    if (!intStr || intStr === '不明') return 'int-unknown';
    const s = intStr.toString();
    if (s.includes('7')) return 'int-7';
    if (s.includes('6強') || s.includes('6+')) return 'int-6u';
    if (s.includes('6弱') || s.includes('6-')) return 'int-6l';
    if (s.includes('5強') || s.includes('5+')) return 'int-5u';
    if (s.includes('5弱') || s.includes('5-')) return 'int-5l';
    if (s.includes('4')) return 'int-4';
    if (s.includes('3')) return 'int-3';
    if (s.includes('2')) return 'int-2';
    if (s.includes('1')) return 'int-1';
    return 'int-low';
  }

  /**
   * 時刻フォーマット
   */
  function formatTime(timeStr) {
    if (!timeStr) return '--/-- --:--';
    const d = new Date(timeStr);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  }

  return {
    init: () => {
      const backBtn = document.getElementById('history-back-btn');
      if (backBtn) backBtn.onclick = showList;
      
      fetchHistory();
      setInterval(fetchHistory, 300000); // 5分おき
    }
  };
})();
