package com.pocketcaddy.app;

import android.util.Log;

import androidx.annotation.NonNull;

import com.google.android.gms.wearable.MessageEvent;
import com.google.android.gms.wearable.Wearable;
import com.google.android.gms.wearable.WearableListenerService;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;

public class PhoneWearableListenerService extends WearableListenerService {

    private static final String TAG = "PocketCaddyPhoneService";
    private static final String PATH_DISTANCES = "/pocketcaddy/distances";
    private static final String PATH_NFC_TAG = "/pocketcaddy/nfc_tag";
    private static final String PATH_LOG_SHOT = "/pocketcaddy/log_shot";
    private static final String PATH_HOLE_CHANGE = "/pocketcaddy/hole_change";
    private static final String PATH_REQUEST_SYNC = "/pocketcaddy/request_sync";

    @Override
    public void onMessageReceived(@NonNull MessageEvent messageEvent) {
        String path = messageEvent.getPath();
        Log.i(TAG, "Wearable message received on Phone service: " + path);

        if (PATH_REQUEST_SYNC.equals(path)) {
            final String nodeId = messageEvent.getSourceNodeId();
            String payloadStr = (MainActivity.sCachedDistancesJson != null)
                ? MainActivity.sCachedDistancesJson
                : "{\"roundActive\":false}";
            byte[] bytes = payloadStr.getBytes(StandardCharsets.UTF_8);
            Wearable.getMessageClient(this).sendMessage(nodeId, PATH_DISTANCES, bytes);
        } else if (PATH_LOG_SHOT.equals(path)) {
            try {
                String jsonStr = new String(messageEvent.getData(), StandardCharsets.UTF_8);
                JSONObject data = new JSONObject(jsonStr);
                String clubId = data.optString("clubId", "");
                String clubName = data.optString("clubName", "");
                String lie = data.optString("lie", "fairway");
                String direction = data.optString("direction", "straight");
                MainActivity.handleWatchLogShot(this, clubId, clubName, lie, direction);
            } catch (Exception e) {
                Log.e(TAG, "Error handling watch log shot in service: " + e.getMessage());
            }
        } else if (PATH_NFC_TAG.equals(path)) {
            try {
                String jsonStr = new String(messageEvent.getData(), StandardCharsets.UTF_8);
                JSONObject data = new JSONObject(jsonStr);
                String tagId = data.optString("tagId", "");
                String text = data.optString("text", "");
                MainActivity.handleWatchTagScanned(this, tagId, text);
            } catch (Exception e) {
                Log.e(TAG, "Error handling watch NFC tag in service: " + e.getMessage());
            }
        } else if (PATH_HOLE_CHANGE.equals(path)) {
            try {
                String jsonStr = new String(messageEvent.getData(), StandardCharsets.UTF_8);
                JSONObject data = new JSONObject(jsonStr);
                String action = data.optString("action", "");
                MainActivity.handleWatchHoleChange(action);
            } catch (Exception ignored) {}
        }
    }
}
