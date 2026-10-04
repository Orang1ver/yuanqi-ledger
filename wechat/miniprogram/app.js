const { envId } = require("./config");
App({
  onLaunch() {
    if (envId && wx.cloud) wx.cloud.init({ env: envId });
  },
});
