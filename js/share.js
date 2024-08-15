wx.ready(function () {
    wx.updateAppMessageShareData({ 
        title: document.title,
        desc: '分享描述',
        link: window.location.href,
        imgUrl: '分享图标的URL',
        success: function () {
            // 设置成功
        }
    });

    wx.updateTimelineShareData({ 
        title: document.title,
        link: window.location.href,
        imgUrl: '分享图标的URL',
        success: function () {
            // 设置成功
        }
    });

    document.getElementById('share-to-timeline').addEventListener('click', function() {
        wx.updateTimelineShareData({ 
            title: document.title,
            link: window.location.href,
            imgUrl: '分享图标的URL',
            success: function () {
                alert('分享成功');
            }
        });
    });
});

wx.error(function(res){
    console.error('微信JS-SDK配置错误:', res);
});