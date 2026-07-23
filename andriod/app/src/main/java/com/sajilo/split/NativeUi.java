package com.sajilo.split;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.content.res.ColorStateList;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageView;
import android.widget.ArrayAdapter;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.Spinner;
import android.widget.TextView;
import android.text.InputType;

import androidx.annotation.DrawableRes;
import androidx.appcompat.content.res.AppCompatResources;
import androidx.core.graphics.drawable.DrawableCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.NumberFormat;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

final class NativeUi {
    static final int BG = Color.rgb(247,245,238);
    static final int PAPER = Color.rgb(255,253,250);
    static final int INK = Color.rgb(23,59,53);
    static final int INK_2 = Color.rgb(36,75,68);
    static final int MUTED = Color.rgb(120,130,125);
    static final int GREEN = Color.rgb(39,129,108);
    static final int GREEN_SOFT = Color.rgb(228,242,237);
    static final int RED = Color.rgb(200,85,73);
    static final int RED_SOFT = Color.rgb(251,235,228);
    static final int ORANGE = Color.rgb(221,112,74);
    static final int LINE = Color.rgb(228,226,216);
    static final int POSITIVE = Color.rgb(30,98,85);
    static final int NEGATIVE = Color.rgb(157,78,69);
    static final int SAND = Color.rgb(233,223,200);

    private NativeUi() {}

    static int dp(Context context, float value) { return Math.round(value * context.getResources().getDisplayMetrics().density); }

    static TextView text(Context context, String value, float sp, int color, boolean bold) {
        TextView view = new TextView(context);view.setText(value);view.setTextSize(sp);view.setTextColor(color);
        view.setGravity(Gravity.CENTER_VERTICAL);view.setFontFeatureSettings("kern");view.setIncludeFontPadding(false);
        if (bold) view.setTypeface(Typeface.create(sp >= 20 ? "sans-serif" : "sans-serif-medium", Typeface.BOLD));
        else view.setTypeface(Typeface.create("sans-serif", Typeface.NORMAL));
        if (sp >= 20) view.setLetterSpacing(-.025f);
        return view;
    }

    static TextView button(Context context, String value, int foreground, int background, float radiusDp) {
        TextView view = text(context,value,14,foreground,true);view.setGravity(Gravity.CENTER);view.setClickable(true);view.setFocusable(true);
        view.setBackground(ripple(context,shape(context,background,radiusDp)));view.setPadding(dp(context,12),0,dp(context,12),0);
        return view;
    }

    static TextView avatar(Context context, String name, String color, int sizeDp) {
        String[] parts = name.trim().split("\\s+");String initials = parts.length == 1 ? parts[0].substring(0,Math.min(2,parts[0].length())) : parts[0].substring(0,1)+parts[parts.length-1].substring(0,1);
        TextView view = text(context,initials.toUpperCase(Locale.US),12,Color.WHITE,true);view.setGravity(Gravity.CENTER);
        int fallback = Color.rgb(93,119,166);int parsed;try { parsed=Color.parseColor(color); } catch(Exception ignored) { parsed=fallback; }
        view.setBackground(shape(context,parsed,sizeDp/2f));view.setLayoutParams(new ViewGroup.LayoutParams(dp(context,sizeDp),dp(context,sizeDp)));return view;
    }

    static GradientDrawable shape(Context context, int color, float radiusDp) {
        GradientDrawable drawable = new GradientDrawable();drawable.setColor(color);drawable.setCornerRadius(dp(context,radiusDp));return drawable;
    }

    static GradientDrawable outlined(Context context, int color, int strokeColor, float radiusDp) {
        GradientDrawable drawable=shape(context,color,radiusDp);drawable.setStroke(dp(context,1),strokeColor);return drawable;
    }

    static GradientDrawable topRounded(Context context,int color,float radiusDp){GradientDrawable drawable=new GradientDrawable();drawable.setColor(color);float radius=dp(context,radiusDp);drawable.setCornerRadii(new float[]{radius,radius,radius,radius,0,0,0,0});return drawable;}

    static RippleDrawable ripple(Context context, GradientDrawable background) {
        return new RippleDrawable(ColorStateList.valueOf(Color.argb(28,23,59,53)),background,null);
    }

    static ImageView icon(Context context, @DrawableRes int drawable, int tint, int paddingDp) {
        ImageView view=new ImageView(context);android.graphics.drawable.Drawable source=AppCompatResources.getDrawable(context,drawable);
        if(source!=null){source=DrawableCompat.wrap(source.mutate());DrawableCompat.setTint(source,tint);view.setImageDrawable(source);}
        view.setScaleType(ImageView.ScaleType.CENTER_INSIDE);view.setPadding(dp(context,paddingDp),dp(context,paddingDp),dp(context,paddingDp),dp(context,paddingDp));return view;
    }

    static ImageView iconButton(Context context,@DrawableRes int drawable,int tint,int background,float radiusDp,int paddingDp){
        ImageView view=icon(context,drawable,tint,paddingDp);view.setBackground(ripple(context,outlined(context,background,LINE,radiusDp)));view.setClickable(true);view.setFocusable(true);return view;
    }

    static EditText input(Context context,String hint,boolean number){
        EditText input=new EditText(context);input.setHint(hint);input.setTextColor(INK);input.setHintTextColor(Color.rgb(146,154,150));input.setTextSize(14);input.setSingleLine(true);
        input.setPadding(dp(context,14),0,dp(context,14),0);input.setBackground(outlined(context,Color.WHITE,LINE,12));
        input.setInputType(number?InputType.TYPE_CLASS_NUMBER|InputType.TYPE_NUMBER_FLAG_DECIMAL:InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        return input;
    }

    static TextView fieldLabel(Context context,String value){
        TextView label=text(context,value.toUpperCase(Locale.US),9,INK_2,true);label.setLetterSpacing(.11f);return label;
    }

    static LinearLayout labeled(Context context,String label,View field,String helper){
        LinearLayout block=new LinearLayout(context);block.setOrientation(LinearLayout.VERTICAL);
        block.addView(fieldLabel(context,label),new LinearLayout.LayoutParams(-1,dp(context,23)));
        block.addView(field,new LinearLayout.LayoutParams(-1,dp(context,52)));
        if(helper!=null&&!helper.isEmpty()){
            TextView help=text(context,helper,10,MUTED,false);help.setPadding(dp(context,2),dp(context,5),0,0);help.setLineSpacing(0,1.08f);
            block.addView(help,new LinearLayout.LayoutParams(-1,-2));
        }
        return block;
    }

    static Spinner spinner(Context context,String[] values){
        Spinner spinner=new Spinner(context,Spinner.MODE_DROPDOWN);
        spinner.setAdapter(new ArrayAdapter<String>(context,android.R.layout.simple_spinner_item,values){
            @Override public View getView(int position,View convertView,ViewGroup parent){return spinnerText(getItem(position)+"   ⌄",true,convertView);}
            @Override public View getDropDownView(int position,View convertView,ViewGroup parent){return spinnerText(getItem(position),false,convertView);}
            private View spinnerText(String value,boolean selected,View convertView){
                TextView view=convertView instanceof TextView?(TextView)convertView:NativeUi.text(context,"",14,INK,selected);
                view.setText(value);view.setTextColor(INK);view.setTextSize(14);view.setGravity(Gravity.CENTER_VERTICAL);view.setPadding(dp(context,14),0,dp(context,14),0);view.setMinHeight(dp(context,52));
                if(!selected)view.setBackgroundColor(Color.WHITE);
                return view;
            }
        });
        spinner.setPadding(0,0,0,0);spinner.setBackground(outlined(context,Color.WHITE,LINE,12));spinner.setPopupBackgroundDrawable(shape(context,Color.WHITE,12));spinner.setDropDownVerticalOffset(dp(context,3));
        return spinner;
    }

    static LinearLayout sectionCard(Context context){
        LinearLayout card=new LinearLayout(context);card.setOrientation(LinearLayout.VERTICAL);card.setPadding(dp(context,13),dp(context,13),dp(context,13),dp(context,13));card.setBackground(outlined(context,Color.WHITE,LINE,16));return card;
    }

    static void elevate(View view,float dp){view.setElevation(NativeUi.dp(view.getContext(),dp));}

    static <T extends ViewGroup.MarginLayoutParams> T margins(Context context,T params,int left,int top,int right,int bottom) {
        params.setMargins(dp(context,left),dp(context,top),dp(context,right),dp(context,bottom));return params;
    }

    static List<JSONObject> objects(JSONArray array) {
        List<JSONObject> values=new ArrayList<>();if(array==null)return values;for(int index=0;index<array.length();index++){JSONObject value=array.optJSONObject(index);if(value!=null)values.add(value);}return values;
    }

    static String money(double amount) { return "रु " + NumberFormat.getIntegerInstance(new Locale("en","NP")).format(Math.round(amount)); }

    static String displayName(String value) {
        String[] parts=value.trim().split("\\s+");if(parts.length<2)return value;return parts[0]+"_("+parts[parts.length-1].substring(0,1).toUpperCase(Locale.US)+")";
    }

    static String eventTime(String iso) {
        try { SimpleDateFormat parser=new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSX",Locale.US);parser.setTimeZone(TimeZone.getTimeZone("UTC"));Date date=parser.parse(iso);return new SimpleDateFormat("h:mm a",Locale.US).format(date); }
        catch(Exception ignored){ try { Date date=new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssX",Locale.US).parse(iso);return new SimpleDateFormat("h:mm a",Locale.US).format(date); } catch(Exception second){return "";} }
    }

    static String relative(String iso) {
        try { SimpleDateFormat parser=new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSX",Locale.US);Date date=parser.parse(iso);long minutes=Math.max(0,(System.currentTimeMillis()-date.getTime())/60000);if(minutes<1)return "now";if(minutes<60)return minutes+"m ago";long hours=minutes/60;if(hours<24)return hours+"h ago";return (hours/24)+"d ago"; }
        catch(Exception ignored){return "";}
    }
}
