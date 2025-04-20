    // 添加SQL.js初始化代码
    async function initSQL() {
      const config = {
        locateFile: filename => `https://cdn.jsdelivr.net/npm/sql.js@1.8.0/dist/${filename}`
      };
      return initSqlJs(config);
    }

    // 全局变量
    // 最顶部只声明一次
    let chart, candleSeries, lineSeries;
    let equityChart, equitySeries;
    let lastTime = 0, currentPrice = 0;
    let db, position = null, entryPrice = 0;
    let loadedCount = 60, currentOffset = 0;
    let cumulativePnl = 0, tradeHistory = [];
    let lastBar = null;
    let allBarData = [];
    // 放到文件最顶部，和其他全局变量同一层
    let tradeMarkers = [];
    let tradeLines   = [];
    // 保存当前持仓的 entry 信息
    const batchSize   = 1;         // 每次加载多少根 K 线
    let currentEntry = null;
    let KCount = 60;  // 滑动窗口每次显示 60 根
    const appendCount  = 1;   // 追加历史每次追加 1 根
    let slideOffset   = 0;    // 窗口偏移
    let appendOffset  = 0;    // 追加偏移
    // 如果保留历史模式，就一次加载更多，然后 append；否则走滑动窗口逻辑
    
    // 初始加载完 allBarData 后，调用此函数来对齐两个偏移量
    function initOffsets() {
      slideOffset  = 0;
      appendOffset = allBarData.length;
    }

    function bindAutoResize(chart, container) {
      // 当 container 尺寸变化时，自动 applyOptions + fitContent
      const ro = new ResizeObserver(entries => {
        for (let entry of entries) {
          const { width, height } = entry.contentRect;
          chart.applyOptions({ width, height });
          chart.timeScale().fitContent();
        }
      });
      ro.observe(container);
    }
    
    // 初始化图表（修复LightweightCharts引用）
    function initChart() {
      const c = document.getElementById('chart-container');
      const rect = c.getBoundingClientRect();
      chart = LightweightCharts.createChart(c, {
        width:  rect.width,
        height: rect.height,
        layout: { backgroundColor: '#ffffff', textColor: 'rgba(0, 0, 0, 0.9)' },
        grid: {
          vertLines: { color: 'rgba(0, 0, 0, 0.1)' },
          horzLines: { color: 'rgba(0, 0, 0, 0.1)' }
        },
        rightPriceScale: { visible: true, borderColor: 'rgba(0, 0, 0, 0.1)' },
        timeScale: { borderColor: 'rgba(0, 0, 0, 0.1)', timeVisible: true }
      });

      candleSeries = chart.addCandlestickSeries({
        upColor: '#26a69a',
        downColor: '#ef5350',
        borderVisible: true,
        wickUpColor: '#26a69a',
        wickDownColor: '#ef5350',
      });

      lineSeries = chart.addLineSeries({
        color: '#2962FF',
        lineWidth: 2,
        visible: false,
      });
      
      bindAutoResize(chart, c);
    }

    function initEquityChart() {
      const e = document.getElementById('equity-container');
      // 用容器的实际宽高代替硬编码
      const rect = e.getBoundingClientRect();
      equityChart = LightweightCharts.createChart(e, {
        width:  rect.width,
        height: rect.height,
        rightPriceScale: { visible: false },
        leftPriceScale:  { visible: true },
        layout: { backgroundColor: '#ffffff', textColor: 'rgba(0,0,0,0.9)' },
        grid: {
          vertLines: { color: 'rgba(0,0,0,0.1)' },
          horzLines: { color: 'rgba(0,0,0,0.1)' }
        },
        timeScale: { borderColor: 'rgba(0,0,0,0.1)', timeVisible: true },
        handleScroll: {
          mouseWheel: true,
          pressedMouseMove: true,
        },
        handleScale: {
          axisPressedMouseMove: true,
          mouseWheel: true,
          pinch: true,
        },
      });
      equitySeries = equityChart.addLineSeries({ lineWidth: 2, color: '#FF9900' });
      bindAutoResize(equityChart, e); // 保留你的自动 resize 逻辑
      // 首次绘制时也拉满纵轴
      // 先拿到“首个入场时间”：要么 tradeHistory[0].entryTime，要么 currentEntry.time
      const firstEntryTime = (
        tradeHistory.length > 0
          ? tradeHistory[0].entryTime
          : (currentEntry ? currentEntry.time : null)
      );
      if (firstEntryTime != null) {
        const eqData = eqDataAll.filter(pt => pt.time >= firstEntryTime);
        equitySeries.setData(eqData);
      } else {
        // 既没平也没开，就不画
        equitySeries.setData([]);
      }
      // 只需这一行，让时间轴横向缩放到全量数据
      equityChart.timeScale().fitContent();
    }
    
    
    // 加载数据库文件（添加错误处理）
    async function loadDatabase() {
      try {
        document.getElementById('loading').style.display = 'flex';
        const SQL = await initSQL();
        const response = await fetch('/static/trading_data.db');
        if (!response.ok) throw new Error('数据库加载失败');
        
        const buffer = await response.arrayBuffer();
        db = new SQL.Database(new Uint8Array(buffer));
        console.log('数据库加载完成');
        loadChartData();
      } catch (error) {
        console.error('加载错误:', error);
        alert('加载数据库时出错：' + error.message);
      } finally {
        document.getElementById('loading').style.display = 'none';
      }
    }

    // 覆盖式加载（滑动窗口模式）
    function loadChartData() {
      if (!db) return;
      const stmt = db.prepare(`
        SELECT timestamp, open, high, low, close
          FROM trading_data
        ORDER BY timestamp ASC
        LIMIT ${KCount} OFFSET ${slideOffset}
      `);
      const bars = [];
      while (stmt.step()) {
        const r = stmt.getAsObject();
        const dt = luxon.DateTime.fromSQL(r.timestamp);
        if (!dt.isValid) continue;
        bars.push({
          time:  dt.toJSDate().getTime() / 1000,
          open:  r.open,
          high:  r.high,
          low:   r.low,
          close: r.close,
        });
      }
      stmt.free();

      allBarData = bars;                   // **覆盖**掉旧数据
      candleSeries.setData(allBarData);
      lineSeries.setData(allBarData.map(b => ({ time: b.time, value: b.close })));
      chart.timeScale().fitContent();

      // === 新增：更新 lastBar 和 currentPrice ===
      lastBar = allBarData[allBarData.length - 1];    // 最后一根
      currentPrice = lastBar.close;                   // 最新收盘价
      appendOffset = allBarData.length;    // 同步“追加”起点
      updateTradeInfo();
      renderTradeHistory();
      // ——— 新增：加载或追加完 K 线后，更新净值曲线 ———
      // ——— 更新净值曲线（支持未平仓状态） ———
      const eqDataAll = calculateEquitySeries(allBarData, tradeHistory);
      // 先拿到“首个入场时间”：要么 tradeHistory[0].entryTime，要么 currentEntry.time
      const firstEntryTime = (
        tradeHistory.length > 0
          ? tradeHistory[0].entryTime
          : (currentEntry ? currentEntry.time : null)
      );
      if (firstEntryTime != null) {
        const eqData = eqDataAll.filter(pt => pt.time >= firstEntryTime);
        equitySeries.setData(eqData);
      } else {
        // 既没平也没开，就不画
        equitySeries.setData([]);
      }
      equityChart.timeScale().fitContent();

    }

    function renderTradeHistory() {
      const tbody = document.querySelector('#trade-history tbody');
      tbody.innerHTML = '';
      tradeHistory.forEach(tr => {
        const trEl = document.createElement('tr');
        trEl.innerHTML = `
          <td style="padding:4px; text-align:center">${tr.side}</td>
          <td style="padding:4px">
            ${luxon.DateTime.fromSeconds(tr.entryTime)
              .toFormat('yyyy-LL-dd HH:mm:ss')}
          </td>
          <td style="padding:4px">
            ${luxon.DateTime.fromSeconds(tr.exitTime)
              .toFormat('yyyy-LL-dd HH:mm:ss')}
          </td>
          <td style="padding:4px">${tr.entryPrice.toFixed(2)}</td>
          <td style="padding:4px">${tr.exitPrice.toFixed(2)}</td>
          <td style="padding:4px">${tr.profit.toFixed(2)}</td>
          <td style="padding:4px">${tr.cumulativePnl.toFixed(2)}</td>
        `;
        tbody.appendChild(trEl);
      });

    }
    // 交易逻辑（保持不变）
    function updatePnl() {
      // 如果有持仓，则计算当前未平仓盈亏，并累加之前累计盈亏
      let displayPnl = cumulativePnl;
      if (position === 'long') {
        displayPnl += (currentPrice - entryPrice) * 100;
      } else if (position === 'short') {
        displayPnl += (entryPrice - currentPrice) * 100;
      }
      const pnlElement = document.getElementById('pnlDisplay');
      pnlElement.textContent = `累计盈亏: ${displayPnl.toFixed(2)}`;
      pnlElement.style.color = displayPnl > 0 ? '#4CAF50' : displayPnl < 0 ? '#F44336' : 'white';
    }
    
    function updateTradeInfo() {
      let info = '';
      if (position) {
        info += `当前持仓：${position === 'long' ? '多头' : '空头'}<br>`;
        info += `入场价格：${entryPrice.toFixed(2)}<br>`;
        const floatingPnl = position === 'long' ? (currentPrice - entryPrice) * 100 : (entryPrice - currentPrice) * 100;
        info += `浮动盈亏：${floatingPnl.toFixed(2)}<br>`;
      } else {
        info += `当前持仓：无<br>`;
        info += `入场价格：--<br>`;
        info += `浮动盈亏：0<br>`;
      }
      info += `累计盈亏：${cumulativePnl.toFixed(2)}`;
      document.getElementById('tradeInfo').innerHTML = info;
    }    

    /**
    * 计算连续净值曲线
    * @param {Array<{time:number,open:number,high:number,low:number,close:number}>} barData 
    * @param {Array<{time:number,type:string,price:number,profit:number, cumulativePnl:number}>} tradeHistory 
    * @returns {Array<{time:number,value:number}>} equityPoints
    */
    function calculateEquitySeries(barData, tradeHistory) {
      let realized = 0;
      let openPos  = null;
      // 1) 复制一份历史，把 currentEntry 当作 exitTime=Infinity 的“未出场”交易
      const history = tradeHistory.slice();
      if (currentEntry) {
        history.push({
          entryTime:  currentEntry.time,
          exitTime:   Infinity,          // 视为还没平
          entryPrice: currentEntry.price,
          profit:     0,                 // 平仓前 realized 不变
          cumulativePnl: cumulativePnl,  // 当前已实现盈亏
          _entered: false,
          _exited:  false,
          // 可以选填：type: '开多' 或 '开空'，用于判断多空
        });
      }
      // 2) 按照 history 计算净值点
      const equityPoints = [];
      history.forEach(tr => { tr._entered = false; tr._exited = false; });
      barData.forEach(bar => {
        history.forEach(tr => {
          if (!tr._entered && bar.time >= tr.entryTime) {
            openPos = { price: tr.entryPrice, isLong: tr.profit >= 0 || true };
            tr._entered = true;
          }
          if (!tr._exited && bar.time >= tr.exitTime) {
            realized += tr.profit;
            openPos = null;
            tr._exited = true;
          }
        });
        const floating = openPos
          ? (bar.close - openPos.price) * 100 * (openPos.isLong ? 1 : -1)
          : 0;
        equityPoints.push({ time: bar.time, value: realized + floating });
      });
      return equityPoints;
    }
    
        /**
     * 在“保留历史数据”模式下，加载下一批 K 线并 append 到 allBarData
     */
    // 累积式加载（追加历史模式）
    function loadMoreAppend() {
      if (!db) return;
      const stmt = db.prepare(`
        SELECT timestamp, open, high, low, close
          FROM trading_data
        ORDER BY timestamp ASC
        LIMIT ${batchSize} OFFSET ${appendOffset}
      `);
      const newBars = [];
      while (stmt.step()) {
        const r = stmt.getAsObject();
        const dt = luxon.DateTime.fromSQL(r.timestamp);
        if (!dt.isValid) continue;
        newBars.push({
          time:  dt.toJSDate().getTime() / 1000,
          open:  r.open,
          high:  r.high,
          low:   r.low,
          close: r.close,
        });
      }
      stmt.free();

      if (!newBars.length) return;         // 没拉到新数据，就不刷新

      allBarData = allBarData.concat(newBars);  // **追加**
      appendOffset += newBars.length;           // 向后推进

      candleSeries.setData(allBarData);
      lineSeries.setData(allBarData.map(b => ({ time: b.time, value: b.close })));
      chart.timeScale().fitContent();

      // === 同样更新 lastBar 和 currentPrice ===
      lastBar = allBarData[allBarData.length - 1];
      currentPrice = lastBar.close;
      updateTradeInfo();
      renderTradeHistory();
      // ——— 新增：加载或追加完 K 线后，更新净值曲线 ———
      // ——— 更新净值曲线（支持未平仓状态） ———
      const eqDataAll = calculateEquitySeries(allBarData, tradeHistory);
      // 先拿到“首个入场时间”：要么 tradeHistory[0].entryTime，要么 currentEntry.time
      const firstEntryTime = (
        tradeHistory.length > 0
          ? tradeHistory[0].entryTime
          : (currentEntry ? currentEntry.time : null)
      );
      if (firstEntryTime != null) {
        const eqData = eqDataAll.filter(pt => pt.time >= firstEntryTime);
        equitySeries.setData(eqData);
      } else {
        // 既没平也没开，就不画
        equitySeries.setData([]);
      }
      equityChart.timeScale().fitContent();

    }
    
    document.getElementById('openLong').addEventListener('click', () => {
      if (!position) {
        position = 'long';
        entryPrice = currentPrice;
        // alert(`开多成功! 入场价格: ${entryPrice.toFixed(2)}`);
        // 记录日志
        currentEntry = { time: lastBar.time, price: entryPrice };
        // 添加“开多”箭头标记
        tradeMarkers.push({
          time: lastBar.time,
          position: 'belowBar',
          color: 'green',
          shape: 'arrowUp',
          text: '多'
        });
        candleSeries.setMarkers(tradeMarkers);

        // —— 每次交易后，用最新 allBarData + tradeHistory 重新算一遍净值 —— 
        // 示例：在 closePosition 里最后更新净值时
        const eqDataAll = calculateEquitySeries(allBarData, tradeHistory);
        const firstEntryTime = (
          tradeHistory.length > 0
            ? tradeHistory[0].entryTime
            : (currentEntry ? currentEntry.time : null)
        );
        if (firstEntryTime != null) {
          const eqData = eqDataAll.filter(pt => pt.time >= firstEntryTime);
          equitySeries.setData(eqData);
        } else {
          equitySeries.setData([]);
        }
        equityChart.timeScale().fitContent();

        updatePnl();
        updateTradeInfo();
      } else {
        alert('您已有持仓，请先平仓!');
      }
    });
    
    document.getElementById('openShort').addEventListener('click', () => {
      if (!position) {
        position = 'short';
        entryPrice = currentPrice;
        // alert(`开空成功! 入场价格: ${entryPrice.toFixed(2)}`);
        currentEntry = { time: lastBar.time, price: entryPrice };
    
        // 添加“开空”箭头标记
        tradeMarkers.push({
          time: lastBar.time,
          position: 'aboveBar',
          color: 'red',
          shape: 'arrowDown',
          text: '空'
        });
        candleSeries.setMarkers(tradeMarkers);

        // —— 每次交易后，用最新 allBarData + tradeHistory 重新算一遍净值 —— 
        // 示例：在 closePosition 里最后更新净值时
        const eqDataAll = calculateEquitySeries(allBarData, tradeHistory);
        const firstEntryTime = (
          tradeHistory.length > 0
            ? tradeHistory[0].entryTime
            : (currentEntry ? currentEntry.time : null)
        );
        if (firstEntryTime != null) {
          const eqData = eqDataAll.filter(pt => pt.time >= firstEntryTime);
          equitySeries.setData(eqData);
        } else {
          equitySeries.setData([]);
        }
        equityChart.timeScale().fitContent();

        updatePnl();
        updateTradeInfo();
      } else {
        alert('您已有持仓，请先平仓!');
      }
    });
    
    document.getElementById('closePosition').addEventListener('click', () => {
      if (position) {
        const exitTime  = lastBar.time;
        const exitPrice = currentPrice;
        const profit = position === 'long'
          ? (currentPrice - entryPrice) * 100
          : (entryPrice - currentPrice) * 100;
        cumulativePnl += profit;
            
        // 添加“平仓”标记（用圆圈或 X）
        const side = position === 'long' ? 1 : -1;
        tradeHistory.push({
          entryTime: currentEntry.time,
          entryPrice: currentEntry.price,
          exitTime,
          exitPrice,
          profit,
          cumulativePnl,
          side, 
        });
        // 更新图标、净值曲线
        tradeMarkers.push({
          time: exitTime,
          position: 'belowBar',
          color: 'gray',
          shape: 'circle',
          text: '平'
        });
        candleSeries.setMarkers(tradeMarkers);

        // —— 每次交易后，用最新 allBarData + tradeHistory 重新算一遍净值 —— 
        // 示例：在 closePosition 里最后更新净值时
        const eqDataAll = calculateEquitySeries(allBarData, tradeHistory);
        const firstEntryTime = (
          tradeHistory.length > 0
            ? tradeHistory[0].entryTime
            : (currentEntry ? currentEntry.time : null)
        );
        if (firstEntryTime != null) {
          const eqData = eqDataAll.filter(pt => pt.time >= firstEntryTime);
          equitySeries.setData(eqData);
        } else {
          equitySeries.setData([]);
        }
        equityChart.timeScale().fitContent();

        // 清仓状态
        position    = null;
        entryPrice  = 0;
        currentEntry= null;

        updatePnl();
        updateTradeInfo();
        renderTradeHistory();
      } else {
        alert('您没有持仓!');
      }
    });

    // ——————————————————————————————————————————
    // 5. 页面初次加载时，记得初始化偏移量！
    // ——————————————————————————————————————————
    window.addEventListener('DOMContentLoaded', async () => {
      initChart();
      initEquityChart();
      await loadDatabase();   // 内部会调用 loadChartData()
    
      // 拿到复选框，一次拿好就不再全局乱用
      const keepHistoryCheckbox = document.getElementById('keepHistory');
    
      // 初始化偏移量
      slideOffset  = 0;
      appendOffset = allBarData.length;
    
      // “加载更多”按钮根据勾选状态，选择调用哪一个
      document.getElementById('loadMore').addEventListener('click', () => {
        if (keepHistoryCheckbox.checked) {
          KCount += 1;
          loadMoreAppend();
          equityChart.timeScale().fitContent();
        } else {
          slideOffset += 1;
          loadChartData();
          equityChart.timeScale().fitContent();
        }
      });
    
      // 切换模式时，重置偏移量并（如必要）立即刷新
      keepHistoryCheckbox.addEventListener('change', () => {
        if (keepHistoryCheckbox.checked) {
          appendOffset = allBarData.length + slideOffset;
        } else {
          loadChartData();
        }
      });
    });
    

    // 左侧：图表 与 控件/持仓 信息 之间的上下拖拽
    (function(){
      const resizer = document.getElementById('left-horizontal-resizer');
      const topPane = document.getElementById('chart-container');
      // 底部我们让控件+tradeInfo 自适应，不需要单独操作
      let startY, startTopHeight;
      resizer.addEventListener('mousedown', e => {
        startY = e.clientY;
        startTopHeight = topPane.getBoundingClientRect().height;
        document.addEventListener('mousemove', resize);
        document.addEventListener('mouseup', stopResize);
      });
      function resize(e) {
        const dy = e.clientY - startY;
        // 限制最小高度 200px
        const newTopH = Math.max(200, startTopHeight + dy);
        topPane.style.flex = `0 0 ${newTopH}px`;
      }
      function stopResize() {
        document.removeEventListener('mousemove', resize);
        document.removeEventListener('mouseup', stopResize);
      }
    })();

    // 左右分割拖拽
    (function(){
      const resizer = document.getElementById('vertical-resizer');
      const left = document.querySelector('.left');
      let startX, startWidth;
      resizer.addEventListener('mousedown', e => {
        startX = e.clientX;
        startWidth = left.getBoundingClientRect().width;
        document.addEventListener('mousemove', resize);
        document.addEventListener('mouseup', stopResize);
      });
      function resize(e) {
        const dx = e.clientX - startX;
        const newLeftWidth = Math.max(200, startWidth + dx);
        left.style.flex = `0 0 ${newLeftWidth}px`;
      }
      function stopResize() {
        document.removeEventListener('mousemove', resize);
        document.removeEventListener('mouseup', stopResize);
      }
    })();

    // 上下分割拖拽（右侧区域）
    (function(){
      const resizer = document.getElementById('horizontal-resizer');
      const topPane = document.getElementById('equity-container');
      let startY, startTopHeight;
      resizer.addEventListener('mousedown', e => {
        startY = e.clientY;
        startTopHeight = topPane.getBoundingClientRect().height;
        document.addEventListener('mousemove', resize);
        document.addEventListener('mouseup', stopResize);
      });
      function resize(e) {
        const dy = e.clientY - startY;
        const newTopHeight = Math.max(100, startTopHeight + dy);
        topPane.style.flex = `0 0 ${newTopHeight}px`;
      }
      function stopResize() {
        document.removeEventListener('mousemove', resize);
        document.removeEventListener('mouseup', stopResize);
      }
    })();
