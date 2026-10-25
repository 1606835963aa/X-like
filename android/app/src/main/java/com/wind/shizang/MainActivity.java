package com.wind.shizang;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import androidx.activity.OnBackPressedCallback;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                getBridge().getWebView().evaluateJavascript(
                    "window.dispatchEvent(new Event('shizang:back',{cancelable:true}))",
                    result -> { if (!"false".equals(result)) MainActivity.this.finish(); }
                );
            }
        });
    }
}
