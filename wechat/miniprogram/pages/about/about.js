const info = require("../../info");

Page({
  data: { info },
  copyLedgerUrl() {
    wx.setClipboardData({ data: info.ledgerUrl });
  },
  copyContactEmail() {
    wx.setClipboardData({ data: info.contactEmail });
  },
  privacy() {
    wx.openPrivacyContract({
      fail: () => wx.showToast({ title: "隐私指引暂不可用", icon: "none" }),
    });
  },
  onShareAppMessage() {
    return { title: info.name, path: "/pages/index/index" };
  },
});
