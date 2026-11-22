package com.ederproducer.ankiingles;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Atualização direto do GitHub Releases: baixa o APK e abre o instalador do sistema.
 * O arquivo fica em Android/data/<pacote>/files/updates, fora da pasta de backup.
 */
@CapacitorPlugin(name = "AppUpdater")
public class UpdaterPlugin extends Plugin {

    private static final String APK_NAME = "anki-ingles-android.apk";

    private boolean canInstall() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
        return getContext().getPackageManager().canRequestPackageInstalls();
    }

    private String versionName() {
        try {
            return getContext().getPackageManager()
                    .getPackageInfo(getContext().getPackageName(), 0).versionName;
        } catch (PackageManager.NameNotFoundException e) {
            return "";
        }
    }

    private File apkFile() {
        File dir = new File(getContext().getExternalFilesDir(null), "updates");
        if (!dir.exists()) dir.mkdirs();
        return new File(dir, APK_NAME);
    }

    @PluginMethod
    public void getVersion(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("version", versionName());
        ret.put("canInstall", canInstall());
        call.resolve(ret);
    }

    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Não foi possível abrir as configurações de instalação", e);
        }
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        final String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("URL do APK não informada");
            return;
        }

        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    File apk = apkFile();
                    HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
                    connection.setInstanceFollowRedirects(true);
                    connection.setConnectTimeout(20000);
                    connection.setReadTimeout(30000);
                    connection.setRequestProperty("User-Agent", "anki-ingles-android-updater");
                    connection.connect();

                    int status = connection.getResponseCode();
                    if (status < 200 || status >= 300) {
                        throw new Exception("HTTP " + status + " ao baixar o APK");
                    }

                    InputStream in = new BufferedInputStream(connection.getInputStream());
                    FileOutputStream out = new FileOutputStream(apk, false);
                    byte[] buffer = new byte[16384];
                    int read;
                    while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
                    out.flush();
                    out.close();
                    in.close();
                    connection.disconnect();

                    if (apk.length() < 1024) throw new Exception("APK baixado está vazio");

                    JSObject result = new JSObject();
                    result.put("path", apk.getAbsolutePath());
                    result.put("size", apk.length());

                    if (!canInstall()) {
                        result.put("ok", false);
                        result.put("needsPermission", true);
                        call.resolve(result);
                        return;
                    }

                    Uri uri = FileProvider.getUriForFile(
                            getContext(), getContext().getPackageName() + ".fileprovider", apk);
                    Intent intent = new Intent(Intent.ACTION_VIEW);
                    intent.setDataAndType(uri, "application/vnd.android.package-archive");
                    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(intent);

                    result.put("ok", true);
                    result.put("needsPermission", false);
                    call.resolve(result);
                } catch (final Exception e) {
                    call.reject("Falha ao baixar/instalar: " + e.getMessage(), e);
                }
            }
        }, "apk-download").start();
    }
}
