// 初始化图表
const ctx = document.getElementById('price-chart').getContext('2d');
const chart = new Chart(ctx, {
    type: 'candlestick',
    data: {
        datasets: [{
            label: '价格',
            data: []
        }]
    },
    options: {
        responsive: true,
        scales: {
            x: {
                type: 'time',
                time: {
                    unit: 'day'
                }
            },
            y: {
                beginAtZero: false
            }
        }
    }
});

// 加载市场数据
function loadMarketData() {
    fetch('/api/market-data')
        .then(res => res.json())
        .then(data => {
            chart.data.datasets[0].data = data.map(d => ({
                x: new Date(d.time),
                o: d.open,
                h: d.high,
                l: d.low,
                c: d.close
            }));
            chart.update();
        });
}

// 交易操作
document.getElementById('btn-long').addEventListener('click', () => trade('open-long'));
document.getElementById('btn-short').addEventListener('click', () => trade('open-short'));
document.getElementById('btn-close').addEventListener('click', () => trade('close'));

function trade(action) {
    fetch('/api/trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
    })
    .then(res => res.json())
    .then(updateAccountDisplay);
}

// 更新账户信息
function updateAccountDisplay(account) {
    const positionMap = {
        'long': '多头',
        'short': '空头',
        null: '无持仓'
    };
    
    document.getElementById('account-info').innerHTML = `
        账户状态: ${positionMap[account.position]} | 
        余额: $${account.balance.toFixed(2)} | 
        盈亏: $${account.pnl.toFixed(2)}
    `;
}

// 初始加载
loadMarketData();
setInterval(loadMarketData, 30000);  // 每30秒刷新数据