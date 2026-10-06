const { envId } = require("../../config");
const info = require("../../info");
const call = async (action, extra = {}) => {
  const response = await wx.cloud.callFunction({ name: "werun", data: { action, ...extra } });
  if (!response.result || !response.result.ok) throw new Error(response.result?.message || "服务暂不可用，请重试");
  return response.result;
};

Page({
  data: { info, busy: false, message: "", token: "", days: [], synced: false },
  async sync() {
    if (this.data.busy) return;
    if (!envId || !wx.cloud) { this.setData({ message: "步数服务尚未配置，请联系开发者" }); return; }
    this.setData({ busy: true, message: "" });
    try {
      if (wx.requirePrivacyAuthorize) await wx.requirePrivacyAuthorize();
      await wx.login();
      await wx.authorize({ scope: "scope.werun" });
      const result = await wx.getWeRunData();
      if (!result.cloudID) throw new Error("未获取到微信步数，请检查微信运动与云开发设置");
      const snapshot = await call("sync", { cloudID: result.cloudID });
      this.setData({ days: snapshot.days.slice().reverse(), synced: true,
        message: snapshot.days.length ? "同步成功，回到元气账本点击读取最新步数。首次使用请生成连接码。" : "微信暂未提供步数，请启用微信运动后重试。" });
    } catch (error) {
      this.setData({ message: error.message || "同步未完成。请在权限设置中允许微信运动，并稍后重试。" });
    } finally { this.setData({ busy: false }); }
  },
  async connect() {
    if (this.data.busy) return;
    const choice = await wx.showModal({ title: "生成连接码", content: "连接码用于读取微信步数，有效期 90 天。生成后旧连接码立即失效，请只粘贴到自己的元气账本。" });
    if (!choice.confirm || this.data.busy) return;
    this.setData({ busy: true, token: "" });
    try {
      const result = await call("connect");
      this.setData({ token: result.token, message: "连接码已生成，请复制到元气账本的「微信步数」中。" });
    } catch (error) { this.setData({ message: error.message || "生成失败，请重试" }); }
    finally { this.setData({ busy: false }); }
  },
  copy() {
    if (this.data.token) wx.setClipboardData({ data: this.data.token });
  },
  about() { wx.navigateTo({ url: "/pages/about/about" }); },
  onShareAppMessage() { return { title: info.name, path: "/pages/index/index" }; },
  settings() { wx.openSetting(); },
  privacy() { wx.openPrivacyContract({ fail: () => this.setData({ message: "隐私指引暂不可用，请联系开发者" }) }); },
  async revoke() {
    if (this.data.busy || !envId) return;
    const choice = await wx.showModal({ title: "撤销连接并删除云端步数", content: "所有已连接设备将无法继续读取。账本中已经保存的记录会保留。" });
    if (!choice.confirm || this.data.busy) return;
    this.setData({ busy: true });
    try {
      await call("revoke");
      this.setData({ token: "", days: [], synced: false, message: "已撤销连接并删除云端步数。" });
    } catch (error) { this.setData({ message: error.message || "操作未完成，请重试" }); }
    finally { this.setData({ busy: false }); }
  },
});
