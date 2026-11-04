package ph.gov.nagacity.lsmis;

import android.net.Uri;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (this.bridge != null && this.bridge.getWebView() != null) {
            WebView webView = this.bridge.getWebView();
            WebSettings settings = webView.getSettings();

            // Strip Android WebView "; wv" marker so Google OAuth allows sign-in inside the native app
            String defaultUa = settings.getUserAgentString();
            if (defaultUa != null) {
                String cleanUa = defaultUa
                    .replace("; wv)", ")")
                    .replace("; wv", "")
                    .replace("Version/4.0 ", "");
                settings.setUserAgentString(cleanUa);
            }

            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setDatabaseEnabled(true);
            CookieManager.getInstance().setAcceptCookie(true);
            CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

            webView.setWebViewClient(new BridgeWebViewClient(this.bridge) {
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    Uri uri = request.getUrl();
                    if (uri != null && handleOAuthAndCallbackNavigation(view, uri)) {
                        return true;
                    }
                    String host = uri != null && uri.getHost() != null ? uri.getHost().toLowerCase() : "";
                    if (isAuthProviderHost(host)) {
                        return false; // Keep Google & Supabase OAuth inside the app WebView
                    }
                    return super.shouldOverrideUrlLoading(view, request);
                }

                @Override
                @SuppressWarnings("deprecation")
                public boolean shouldOverrideUrlLoading(WebView view, String url) {
                    if (url != null) {
                        Uri uri = Uri.parse(url);
                        if (handleOAuthAndCallbackNavigation(view, uri)) {
                            return true;
                        }
                        String host = uri.getHost() != null ? uri.getHost().toLowerCase() : "";
                        if (isAuthProviderHost(host)) {
                            return false;
                        }
                    }
                    return super.shouldOverrideUrlLoading(view, url);
                }
            });
        }
    }

    private boolean isAuthProviderHost(String host) {
        return host.endsWith("google.com")
            || host.endsWith("accounts.google.com")
            || host.endsWith("googleapis.com")
            || host.endsWith("gstatic.com")
            || host.endsWith("accounts.youtube.com")
            || host.endsWith("supabase.co");
    }

    private boolean handleOAuthAndCallbackNavigation(WebView view, Uri uri) {
        String scheme = uri.getScheme() != null ? uri.getScheme().toLowerCase() : "";
        String host = uri.getHost() != null ? uri.getHost().toLowerCase() : "";
        int port = uri.getPort();
        String path = uri.getEncodedPath() != null ? uri.getEncodedPath() : "/login";
        String query = uri.getEncodedQuery();
        String fragment = uri.getEncodedFragment();

        // Intercept custom scheme ph.gov.nagacity.lsmis://...
        if ("ph.gov.nagacity.lsmis".equals(scheme)) {
            String targetUrl = buildCapacitorLocalUrl("/login", query, fragment);
            view.loadUrl(targetUrl);
            return true;
        }

        // Intercept OAuth callback redirects to http://localhost:5173/... or http://192.168.x.x:5173/...
        boolean isLocalhostWithPort = ("localhost".equals(host) || "127.0.0.1".equals(host)) && port > 0;
        boolean isLanCallback = host.startsWith("192.168.") || host.startsWith("10.") || host.startsWith("172.");
        boolean isHttpLocalhost = "http".equals(scheme) && ("localhost".equals(host) || "127.0.0.1".equals(host));

        if (isLocalhostWithPort || isLanCallback || isHttpLocalhost) {
            String targetPath = (path == null || path.isEmpty() || "/".equals(path)) ? "/login" : path;
            String targetUrl = buildCapacitorLocalUrl(targetPath, query, fragment);
            view.loadUrl(targetUrl);
            return true;
        }

        return false;
    }

    private String buildCapacitorLocalUrl(String path, String query, String fragment) {
        StringBuilder sb = new StringBuilder("https://localhost");
        if (path == null || !path.startsWith("/")) {
            sb.append("/login");
        } else {
            sb.append(path);
        }
        if (query != null && !query.isEmpty()) {
            sb.append("?").append(query);
        }
        if (fragment != null && !fragment.isEmpty()) {
            sb.append("#").append(fragment);
        }
        return sb.toString();
    }
}
