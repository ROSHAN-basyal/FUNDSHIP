package com.sajilo.split;

import android.app.Dialog;
import android.content.Context;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.util.Locale;

/** A consistent, native bottom sheet used by the app's larger workflows. */
final class FundshipSheet {
    interface Action { void run(FundshipSheet sheet); }

    private final Context context;
    private final Dialog dialog;
    private TextView primary;

    private FundshipSheet(Context context) {
        this.context = context;
        this.dialog = new Dialog(context);
    }

    static FundshipSheet show(
            Context context,
            String eyebrow,
            String title,
            String subtitle,
            View content,
            String primaryLabel,
            int heightPercent,
            Action action
    ) {
        FundshipSheet sheet = new FundshipSheet(context);
        sheet.build(eyebrow, title, subtitle, content, primaryLabel, heightPercent, action);
        return sheet;
    }

    private void build(
            String eyebrow,
            String title,
            String subtitle,
            View content,
            String primaryLabel,
            int heightPercent,
            Action action
    ) {
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);

        LinearLayout panel = new LinearLayout(context);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setBackground(NativeUi.topRounded(context, NativeUi.PAPER, 26));
        NativeUi.elevate(panel, 18);

        View handle = new View(context);
        handle.setBackground(NativeUi.shape(context, Color.rgb(207, 207, 198), 2));
        LinearLayout handleRow = new LinearLayout(context);
        handleRow.setGravity(Gravity.CENTER);
        handleRow.addView(handle, new LinearLayout.LayoutParams(dp(42), dp(4)));
        panel.addView(handleRow, new LinearLayout.LayoutParams(-1, dp(22)));

        LinearLayout header = new LinearLayout(context);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(dp(20), 0, dp(12), dp(12));
        LinearLayout words = new LinearLayout(context);
        words.setOrientation(LinearLayout.VERTICAL);
        if (eyebrow != null && !eyebrow.isEmpty()) {
            TextView overline = NativeUi.text(context, eyebrow.toUpperCase(Locale.ROOT), 9, NativeUi.GREEN, true);
            overline.setLetterSpacing(.14f);
            words.addView(overline, new LinearLayout.LayoutParams(-1, dp(19)));
        }
        words.addView(NativeUi.text(context, title, 25, NativeUi.INK, true), new LinearLayout.LayoutParams(-1, dp(36)));
        if (subtitle != null && !subtitle.isEmpty()) {
            TextView description = NativeUi.text(context, subtitle, 12, NativeUi.MUTED, false);
            description.setLineSpacing(0, 1.08f);
            words.addView(description, new LinearLayout.LayoutParams(-1, -2));
        }
        header.addView(words, new LinearLayout.LayoutParams(0, -2, 1));
        TextView close = NativeUi.button(context, "×", NativeUi.INK, Color.rgb(242, 241, 235), 13);
        close.setTextSize(25);
        close.setContentDescription("Close");
        header.addView(close, new LinearLayout.LayoutParams(dp(44), dp(44)));
        close.setOnClickListener(view -> dialog.dismiss());
        panel.addView(header, new LinearLayout.LayoutParams(-1, -2));

        View divider = new View(context);
        divider.setBackgroundColor(NativeUi.LINE);
        panel.addView(divider, new LinearLayout.LayoutParams(-1, dp(1)));

        ScrollView scroll = new ScrollView(context);
        scroll.setFillViewport(false);
        scroll.setClipToPadding(false);
        scroll.setPadding(dp(18), dp(17), dp(18), dp(12));
        scroll.addView(content, new ScrollView.LayoutParams(-1, -2));
        panel.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));

        if (primaryLabel != null && !primaryLabel.isEmpty()) {
            LinearLayout footer = new LinearLayout(context);
            footer.setPadding(dp(18), dp(10), dp(18), dp(16));
            footer.setBackgroundColor(NativeUi.PAPER);
            primary = NativeUi.button(context, primaryLabel, Color.WHITE, NativeUi.INK, 14);
            NativeUi.elevate(primary, 3);
            footer.addView(primary, new LinearLayout.LayoutParams(-1, dp(54)));
            primary.setOnClickListener(view -> action.run(this));
            panel.addView(footer, new LinearLayout.LayoutParams(-1, dp(80)));
        }

        dialog.setContentView(panel);
        dialog.setCanceledOnTouchOutside(true);
        dialog.show();

        Window window = dialog.getWindow();
        if (window != null) {
            window.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
            window.setGravity(Gravity.BOTTOM);
            window.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
            window.setDimAmount(.48f);
            window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
            int screenHeight = context.getResources().getDisplayMetrics().heightPixels;
            int height = Math.min(screenHeight - dp(18), Math.round(screenHeight * Math.max(60, Math.min(96, heightPercent)) / 100f));
            window.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, height);
            window.setNavigationBarColor(NativeUi.PAPER);
        }
    }

    void dismiss() { dialog.dismiss(); }

    void setBusy(boolean busy, String busyLabel, String normalLabel) {
        if (primary == null) return;
        primary.setEnabled(!busy);
        primary.setAlpha(busy ? .62f : 1f);
        primary.setText(busy ? busyLabel : normalLabel);
    }

    private int dp(int value) { return NativeUi.dp(context, value); }
}
