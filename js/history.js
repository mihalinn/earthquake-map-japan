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

    // 最新15件を表示
    historyData.slice(0, 15).forEach(item => {
      const el = document.createElement('div');
      el.className = 'history-item';

      const intensityClass = getIntensityClass(item.shindo);

      el.innerHTML = `
        <div class="history-item-left">
          <span class="intensity-badge ${intensityClass}">${item.shindo}</span>
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

      // クリックで地図ジャンプ
      el.onclick = () => {
        if (item.latitude && item.longitude) {
          MapManager.getMap().flyTo({
            center: [parseFloat(item.longitude), parseFloat(item.latitude)],
            zoom: 8,
            speed: 1.2
          });
        }
      };

      listContainer.appendChild(el);
    });
  }

  /**
   * 震度に応じたCSSクラス
   */
  function getIntensityClass(intStr) {
    if (!intStr) return 'int-low';
    if (intStr.includes('7')) return 'int-7';
    if (intStr.includes('6')) return 'int-6';
    if (intStr.includes('5')) return 'int-5';
    if (intStr.includes('4')) return 'int-4';
    if (intStr.includes('3')) return 'int-3';
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
      fetchHistory();
      setInterval(fetchHistory, 300000); // 5分おき
    }
  };
})();
