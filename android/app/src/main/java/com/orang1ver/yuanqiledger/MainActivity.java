package com.orang1ver.yuanqiledger;

import android.content.SharedPreferences;
import android.os.Bundle;
import android.util.Log;

import com.getcapacitor.BridgeActivity;

import java.io.File;
import java.io.FileInputStream;
import java.nio.charset.StandardCharsets;

/**
 * 元气账本 —— 安卓壳唯一的原生代码，只做一件事：**OTA 的回滚保险**。
 *
 * 为什么非有它不可：OTA 换版本后如果新版本白屏，**JS 根本跑不起来**，
 * 网页侧没有任何代码能把自己救回去（这就是"纯 JS 的死结"）。
 * 唯一还活着的是这里，而它必须在 `Bridge` 读配置**之前**动手 ——
 * 也就是 `super.onCreate()` 之前。
 *
 * 判据（JS 侧配合写、这里读）：
 *   - `files/ota/.pending`：切基址前由 JS 写下，内容是**上一个可用版本号**。
 *     能跑到这里说明上次切完之后没等到"启动成功"的确认 → 判定失败，回滚。
 *   - 新版本启动成功后会自己删掉这个标记（见 `app/lib/ota-runner.ts` 的 `confirmOtaBoot`）。
 *
 * 回滚动作 = 把持久化的基址改回上一版（没有上一版就置空 → 回到 APK 里的打包资源）。
 *
 * ⚠️ 顺序不能反：`Bridge` 是在 `super.onCreate()` 里创建并读这个配置的，
 * 晚一步写就等于没写。
 * ⚠️ 必须用 `commit()` 而不是 `apply()`：后者是异步落盘，Bridge 立刻就会读，来不及。
 */
public class MainActivity extends BridgeActivity {
    private static final String TAG = "YuanqiOta";
    /** 与 Capacitor 内置 WebView 插件共用同一份 SharedPreferences 与同一个键 */
    private static final String PREFS = "CapWebViewSettings";
    private static final String KEY_BASE_PATH = "serverBasePath";
    private static final String OTA_DIR = "ota";
    private static final String PENDING = ".pending";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        rollbackIfUnconfirmed();
        super.onCreate(savedInstanceState);
    }

    private void rollbackIfUnconfirmed() {
        try {
            File otaRoot = new File(getFilesDir(), OTA_DIR);
            File flag = new File(otaRoot, PENDING);
            if (!flag.exists()) {
                return; // 没有未确认的切换 —— 正常启动
            }

            SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
            String badPath = prefs.getString(KEY_BASE_PATH, "");
            String previous = readText(flag).trim();

            SharedPreferences.Editor editor = prefs.edit();
            File prevDir = previous.isEmpty() ? null : new File(otaRoot, previous);
            if (prevDir != null && new File(prevDir, "index.html").exists()) {
                editor.putString(KEY_BASE_PATH, prevDir.getAbsolutePath());
                Log.w(TAG, "上次 OTA 未确认，回滚到 " + previous);
            } else {
                editor.putString(KEY_BASE_PATH, "");
                Log.w(TAG, "上次 OTA 未确认且没有可回退版本，回到打包资源");
            }
            editor.commit();

            // ⚠️ 必须把闯祸的那一版**隔离掉**，否则网页侧会认为"已经下好了"、
            //    再切回来 → 又白屏 → 又回滚，陷入死循环。
            //    改名成 `.tmp` 后缀即可：网页侧本来就跳过 `.tmp`，且下次下载会清掉它。
            quarantine(new File(badPath));

            //noinspection ResultOfMethodCallIgnored
            flag.delete();
        } catch (Exception e) {
            // 回滚失败也不能挡住启动 —— 大不了用户重装 APK
            Log.e(TAG, "回滚检查失败（忽略，继续启动）", e);
        }
    }

    /** 把坏掉的版本目录改名成 `xxx.tmp`（先清掉可能已存在的同名目录） */
    private static void quarantine(File dir) {
        if (dir == null || !dir.isDirectory()) {
            return;
        }
        File target = new File(dir.getParentFile(), dir.getName() + ".tmp");
        deleteRecursively(target);
        if (!dir.renameTo(target)) {
            Log.w(TAG, "隔离失败：" + dir.getAbsolutePath());
        }
    }

    private static void deleteRecursively(File f) {
        if (f == null || !f.exists()) {
            return;
        }
        File[] children = f.listFiles();
        if (children != null) {
            for (File c : children) {
                deleteRecursively(c);
            }
        }
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }

    private static String readText(File f) throws Exception {
        try (FileInputStream in = new FileInputStream(f)) {
            byte[] buf = new byte[(int) f.length()];
            int n = in.read(buf);
            return new String(buf, 0, Math.max(n, 0), StandardCharsets.UTF_8);
        }
    }
}
