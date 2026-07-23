package com.sajilo.split;

import android.content.Intent;

import org.json.JSONException;
import org.json.JSONArray;
import org.json.JSONObject;

final class PollPayload {
    static final String EXTRA_JSON = "poll_payload";

    final String pollId;
    final String groupName;
    final String groupEmoji;
    final String title;
    final String dateLabel;
    final String bsDate;
    final String timeLabel;
    final int yesCount;
    final int minYes;
    final int remindAfterMinutes;
    final String pollType;
    final JSONArray options;

    PollPayload(String pollId, String groupName, String groupEmoji, String title,
                String dateLabel, String bsDate, String timeLabel,
                int yesCount, int minYes, int remindAfterMinutes, String pollType, JSONArray options) {
        this.pollId = pollId;
        this.groupName = groupName;
        this.groupEmoji = groupEmoji;
        this.title = title;
        this.dateLabel = dateLabel;
        this.bsDate = bsDate;
        this.timeLabel = timeLabel;
        this.yesCount = yesCount;
        this.minYes = minYes;
        this.remindAfterMinutes = remindAfterMinutes;
        this.pollType = pollType;
        this.options = options == null ? new JSONArray() : options;
    }

    JSONObject toJson() throws JSONException {
        JSONObject json = new JSONObject();
        json.put("pollId", pollId);
        json.put("groupName", groupName);
        json.put("groupEmoji", groupEmoji);
        json.put("title", title);
        json.put("dateLabel", dateLabel);
        json.put("bsDate", bsDate);
        json.put("timeLabel", timeLabel);
        json.put("yesCount", yesCount);
        json.put("minYes", minYes);
        json.put("remindAfterMinutes", remindAfterMinutes);
        json.put("pollType", pollType);
        json.put("options", options);
        return json;
    }

    static PollPayload fromJson(String raw) {
        if (raw == null || raw.isEmpty()) return null;
        try {
            JSONObject json = new JSONObject(raw);
            return new PollPayload(
                json.optString("pollId"), json.optString("groupName"), json.optString("groupEmoji"),
                json.optString("title"), json.optString("dateLabel"), json.optString("bsDate"),
                json.optString("timeLabel"), json.optInt("yesCount"), Math.max(1, json.optInt("minYes")),
                Math.max(1, json.optInt("remindAfterMinutes", 120)), json.optString("pollType", "yes_no"),
                json.optJSONArray("options")
            );
        } catch (JSONException ignored) {
            return null;
        }
    }

    static PollPayload fromIntent(Intent intent) {
        return fromJson(intent == null ? null : intent.getStringExtra(EXTRA_JSON));
    }

    String asIntentExtra() {
        try { return toJson().toString(); }
        catch (JSONException ignored) { return "{}"; }
    }

}
