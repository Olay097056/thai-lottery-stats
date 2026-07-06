"""
สถิติหวยไทย — Streamlit Dashboard
ดึงข้อมูลจาก myhora.com
"""
import streamlit as st
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import plotly.io as pio
from datetime import datetime
from scraper import load_data, get_cache_info, incremental_update
from analyzer import (
    filter_df, freq_table, hot_cold_numbers, heatmap_data,
    trend_data, never_appeared, digit_frequency, summary_stats,
    overdue_numbers, predict_numbers, next_thai_draw,
    pair_analysis, consecutive_pattern, decade_comparison, number_profile,
    predict_with_reasons, overdue_with_prob, ticket_analysis,
    alert_engine, number_network_data,
    ensemble_predict, prediction_confidence,
    predict_prize1, predict_prize1_v2, predict_prize1_v3, predict_prize1_v4,
    prize1_backtest, prize1_digit_analysis,
    LOTTERY_TYPES, MONTH_TH, WEEKDAYS, DAY_MAP,
)
from ml_predictor import predict_ml, train_model, get_feature_importance, model_exists
from watchlist import (
    load_watchlist, save_watchlist, add_to_watchlist,
    remove_from_watchlist, watchlist_status,
)

pio.templates.default = "plotly_dark"
_PLOT_BG = "#0e1117"
_PLOT_PAPER = "#0e1117"
_PLOT_GRID = "#2a2a3e"

# ─── Page config ───────────────────────────────────────────────────────────────
st.set_page_config(
    page_title="สถิติหวยไทย",
    page_icon="🎰",
    layout="wide",
    initial_sidebar_state="expanded",
)

st.markdown("""
<style>
/* ── Number boxes ── */
.top5-box {
    background: linear-gradient(135deg, #f5e642 0%, #f0a500 100%);
    border-radius: 16px;
    padding: 18px 28px;
    font-size: 2.6rem;
    font-weight: 900;
    text-align: center;
    letter-spacing: 10px;
    color: #1a1a1a;
    margin-bottom: 16px;
    box-shadow: 0 4px 24px rgba(245,230,66,0.25);
}
/* ── Prediction number badges ── */
.num-badge {
    display: inline-block;
    background: linear-gradient(135deg, #1a1a2e, #16213e);
    border: 2px solid #f5e642;
    border-radius: 10px;
    padding: 10px 18px;
    font-size: 1.7rem;
    font-weight: bold;
    color: #f5e642;
    margin: 5px 4px;
    letter-spacing: 4px;
    box-shadow: 0 2px 12px rgba(245,230,66,0.15);
}
.num-badge-hot {
    border-color: #ff6b35;
    color: #ff6b35;
    box-shadow: 0 2px 12px rgba(255,107,53,0.2);
}
.num-badge-cold {
    border-color: #4cc9f0;
    color: #4cc9f0;
    box-shadow: 0 2px 12px rgba(76,201,240,0.2);
}
/* ── Reason tags ── */
.reason-tag {
    display: inline-block;
    background: rgba(245,230,66,0.15);
    border: 1px solid rgba(245,230,66,0.4);
    border-radius: 20px;
    padding: 2px 10px;
    font-size: 0.75rem;
    color: #f5e642;
    margin: 2px 2px;
}
/* ── Ticket number buttons ── */
.ticket-num {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 44px; height: 44px;
    border-radius: 50%;
    background: #1a1a2e;
    border: 2px solid #333;
    font-size: 1rem;
    font-weight: bold;
    color: #aaa;
    margin: 3px;
    cursor: pointer;
    transition: all .2s;
}
.ticket-num-selected {
    background: #f5e642;
    border-color: #f5e642;
    color: #1a1a1a;
    box-shadow: 0 0 12px rgba(245,230,66,0.4);
}
/* ── Stat mini-card ── */
.mini-card {
    background: #1a1a2e;
    border-radius: 10px;
    padding: 12px 16px;
    border-left: 3px solid #f5e642;
    margin-bottom: 8px;
}
/* ── Countdown banner ── */
.countdown-banner {
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    border: 1px solid rgba(245,230,66,0.2);
    border-radius: 14px;
    padding: 14px 22px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 14px;
    box-shadow: 0 2px 16px rgba(0,0,0,0.3);
}
/* ── Animated hot badge ── */
@keyframes pulse-hot {
    0%   { box-shadow: 0 0 0 0 rgba(255,107,53,.5); }
    70%  { box-shadow: 0 0 0 8px rgba(255,107,53,0); }
    100% { box-shadow: 0 0 0 0 rgba(255,107,53,0); }
}
.badge-hot { animation: pulse-hot 2s infinite; }
</style>
""", unsafe_allow_html=True)


def dark_layout(fig, height=380, title=None):
    """Apply consistent dark theme to any plotly figure."""
    kwargs = dict(
        paper_bgcolor=_PLOT_PAPER,
        plot_bgcolor=_PLOT_BG,
        font=dict(color="#fafafa", family="sans-serif"),
        height=height,
        margin=dict(l=40, r=20, t=40 if title else 20, b=40),
        xaxis=dict(gridcolor=_PLOT_GRID, zerolinecolor=_PLOT_GRID),
        yaxis=dict(gridcolor=_PLOT_GRID, zerolinecolor=_PLOT_GRID),
    )
    if title:
        kwargs["title"] = title
    fig.update_layout(**kwargs)
    return fig


# ─── Load data ─────────────────────────────────────────────────────────────────
@st.cache_data(show_spinner=False)
def get_data(force=False):
    return load_data(force_refresh=force)


@st.cache_data(show_spinner=False)
def get_data_incremental():
    return incremental_update()


def init_data():
    """โหลดข้อมูล + แสดง progress ถ้า scrape ใหม่"""
    cache = get_cache_info()
    if not cache["exists"]:
        st.info("ยังไม่มี cache — กำลัง scrape ข้อมูลจาก myhora.com (ใช้เวลา ~2-3 นาที)")
        progress_bar = st.progress(0)
        status_text = st.empty()

        def update_progress(pct, msg):
            progress_bar.progress(pct)
            status_text.text(msg)

        df = load_data(force_refresh=False, progress_callback=update_progress)
        progress_bar.empty()
        status_text.empty()
        return df
    return get_data()


# ─── Sidebar ──────────────────────────────────────────────────────────────────
with st.sidebar:
    st.title("🎰 สถิติหวยไทย")
    st.caption("ข้อมูลจาก myhora.com")

    # ── Cache management ──
    cache = get_cache_info()
    if cache["exists"]:
        st.success(f"Cache: {cache['rows']:,} งวด\n\n{cache['min_date'].strftime('%d/%m/%Y')} — {cache['max_date'].strftime('%d/%m/%Y')}")

        # auto-update banner ถ้า cache เก่ากว่า 15 วัน
        if cache.get("needs_update"):
            st.warning(f"⚠️ ข้อมูลเก่า {cache['days_old']} วัน")
            if st.button("⚡ อัปเดตงวดใหม่ (เร็ว)"):
                with st.spinner("กำลัง scrape เฉพาะปีปัจจุบัน..."):
                    get_data.clear()
                    get_data_incremental.clear()
                    incremental_update()
                    get_data.clear()
                st.rerun()

        col_btn1, col_btn2 = st.columns(2)
        with col_btn1:
            if st.button("🔄 อัปเดตงวดใหม่"):
                with st.spinner("กำลัง scrape..."):
                    get_data.clear()
                    get_data_incremental.clear()
                    incremental_update()
                    get_data.clear()
                st.rerun()
        with col_btn2:
            if st.button("♻️ Scrape ทั้งหมด"):
                get_data.clear()
                get_data_incremental.clear()
                st.rerun()
    else:
        st.warning("ยังไม่มีข้อมูล")

    st.divider()

    # ── Lottery type ──
    lottery_type = st.selectbox("ประเภทหวย", list(LOTTERY_TYPES.keys()))
    col_name = LOTTERY_TYPES[lottery_type]

    st.divider()

    # ── Year range ──
    st.subheader("ช่วงปี (ค.ศ.)")
    year_range = st.slider("", 1994, 2026, (2011, 2026), label_visibility="collapsed")

    # ── Month filter (multiselect) ──
    st.subheader("เดือน")
    all_months = list(MONTH_TH.keys())
    all_month_names = list(MONTH_TH.values())
    sel_month_names = st.multiselect(
        "", all_month_names, default=all_month_names, label_visibility="collapsed", key="month_filter"
    )
    selected_months = [k for k, v in MONTH_TH.items() if v in sel_month_names]

    # ── Day of week filter (multiselect) ──
    st.subheader("วันในสัปดาห์")
    sel_days = st.multiselect(
        "", WEEKDAYS, default=WEEKDAYS, label_visibility="collapsed", key="day_filter"
    )
    selected_days = sel_days

    # ── Draw date filter ──
    st.subheader("วันที่ในเดือน")
    draw_date_choice = st.radio("", ["1 และ 16", "เฉพาะ 1", "เฉพาะ 16"],
                                horizontal=True, label_visibility="collapsed")
    if draw_date_choice == "เฉพาะ 1":
        draw_dates = [1]
    elif draw_date_choice == "เฉพาะ 16":
        draw_dates = [16]
    else:
        draw_dates = [1, 16]

    st.divider()
    top_n = st.slider("แสดง Top N เลข", 5, 30, 10)

    # ── Watchlist ──
    st.divider()
    st.subheader("⭐ Watchlist")
    _wl = load_watchlist()
    _wl_nums = _wl.get(col_name, [])
    if _wl_nums:
        for _wn in list(_wl_nums):
            wc1, wc2 = st.columns([3, 1])
            wc1.markdown(f"**{_wn}**")
            if wc2.button("✕", key=f"wl_rm_{_wn}"):
                remove_from_watchlist(col_name, _wn)
                st.rerun()
    else:
        st.caption("ยังไม่มีเลขในรายการ")
    _wl_add_col, _wl_btn = st.columns([2, 1])
    _wl_new = _wl_add_col.text_input("เพิ่มเลข", key="wl_add", label_visibility="collapsed",
                                      placeholder="เลข...")
    if _wl_btn.button("➕", key="wl_add_btn") and _wl_new:
        _digits_wl = 2 if col_name in ("top2","bottom2") else (6 if col_name=="prize1" else 3)
        add_to_watchlist(col_name, _wl_new.strip().zfill(_digits_wl))
        st.rerun()


# ─── Load & filter ────────────────────────────────────────────────────────────
df_raw = init_data()

if df_raw is None or df_raw.empty:
    st.error("ไม่มีข้อมูล — กด 'อัปเดตข้อมูล' ใน sidebar")
    st.stop()

df = filter_df(
    df_raw,
    years=year_range,
    months=selected_months if selected_months else None,
    days_of_week=selected_days if selected_days else None,
    dates=draw_dates if draw_dates else None,
)

if df.empty:
    st.warning("ไม่มีข้อมูลตาม filter ที่เลือก")
    st.stop()

stats = summary_stats(df, col_name)
freq_df = freq_table(df, col_name)


# ─── Next draw countdown ──────────────────────────────────────────────────────
_upcoming_hdr = next_thai_draw(datetime.now())
_next = _upcoming_hdr[0]
_days_left = (_next["date"] - datetime.now()).days
_next_label = f"{_next['day']} {MONTH_TH.get(_next['month'], '')} {_next['year']+543}"

st.markdown(f"""
<div style="background:linear-gradient(135deg,#1a1a2e,#16213e);border-radius:12px;padding:14px 20px;
    display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
  <div style="color:#aaa;font-size:.85rem;">งวดถัดไป</div>
  <div style="color:#f5e642;font-size:1.15rem;font-weight:bold;">{_next_label}</div>
  <div style="background:#f5e642;color:#1a1a1a;border-radius:8px;padding:4px 14px;
      font-size:1.4rem;font-weight:bold;">อีก {_days_left} วัน</div>
</div>
""", unsafe_allow_html=True)

# ─── Alert + Watchlist status ────────────────────────────────────────────────
_alerts = alert_engine(df_raw, col_name)
_wl_curr = load_watchlist().get(col_name, [])

_alert_col, _wl_col = st.columns([3, 2])
with _alert_col:
    if _alerts:
        _hot = [a for a in _alerts if a["ระดับ"] == "🔥"]
        _warn = [a for a in _alerts if a["ระดับ"] == "⚠️"]
        _info = [a for a in _alerts if a["ระดับ"] == "ℹ️"]
        if _hot:
            for a in _hot[:2]:
                st.error(f"{a['ระดับ']} **เลข {a['เลข']}** — {a['ข้อความ']}")
        if _warn:
            for a in _warn[:3]:
                st.warning(f"{a['ระดับ']} **เลข {a['เลข']}** — {a['ข้อความ']}")
        if _info:
            for a in _info[:2]:
                st.info(f"{a['ระดับ']} **เลข {a['เลข']}** — {a['ข้อความ']}")

with _wl_col:
    if _wl_curr:
        st.markdown("**⭐ Watchlist**")
        _wl_status = watchlist_status(df_raw, col_name, _wl_curr)
        for _, _wr in _wl_status.iterrows():
            _alert_txt = _wr["แจ้งเตือน"]
            _color = "#f5e642" if _alert_txt.startswith("🎉") else ("#ff6b35" if "⚠️" in _alert_txt else "#888")
            st.markdown(
                f'<div class="mini-card">'
                f'<b style="color:{_color}">{_wr["เลข"]}</b> '
                f'<span style="color:#aaa;font-size:.8rem">ค้าง {_wr["ค้างกี่งวด"]} งวด</span>'
                f'{f" <b style=\'color:{_color}\'>{_alert_txt}</b>" if _alert_txt else ""}'
                f'</div>',
                unsafe_allow_html=True
            )

# ─── Global quick search ──────────────────────────────────────────────────────
_qs_col, _qs_btn_col = st.columns([4, 1])
with _qs_col:
    _quick_search = st.text_input("🔍 ค้นหาเลขด่วน", placeholder="พิมพ์เลขเพื่อดูสถิติทันที...",
                                  label_visibility="collapsed", key="global_search")
with _qs_btn_col:
    st.button("ค้นหา", use_container_width=True)

if _quick_search:
    _digits = 2 if col_name in ("top2", "bottom2") else (6 if col_name == "prize1" else 3)
    _qpad = _quick_search.strip().zfill(_digits)
    _qcount = (df[col_name].astype(str).replace("nan", "") == _qpad).sum()
    _qsub = df[df[col_name].astype(str).replace("nan", "") == _qpad]
    _qlast = _qsub["date"].max().strftime("%d/%m/%Y") if not _qsub.empty else "ไม่เคยออก"
    _qtotal = len(df)
    _qrate = f"{_qcount/_qtotal*100:.1f}%" if _qtotal else "0%"
    _qoverdue = number_profile(df, col_name, _qpad)["overdue"]
    qs1, qs2, qs3, qs4 = st.columns(4)
    qs1.metric(f"เลข {_qpad}", f"ออก {_qcount} ครั้ง")
    qs2.metric("อัตราการออก", _qrate)
    qs3.metric("ออกล่าสุด", _qlast)
    qs4.metric("ค้างมานาน", f"{_qoverdue} งวด")

# ─── Header & Top 5 ──────────────────────────────────────────────────────────
st.title(f"สถิติ {lottery_type}")
st.caption(f"ช่วงปี {year_range[0]}–{year_range[1]} | {stats['total_draws']:,} งวด")

top5_nums = [str(n) for n in freq_df["เลข"].head(5).tolist() if pd.notna(n) and str(n) not in ("", "nan")]
top5_str = " / ".join(top5_nums) if top5_nums else "-"
st.markdown(f'<div class="top5-box">⭐ เลขเด็ด 5 อันดับ<br>{top5_str}</div>', unsafe_allow_html=True)

# ─── Summary metrics ──────────────────────────────────────────────────────────
m1, m2, m3, m4 = st.columns(4)
m1.metric("งวดทั้งหมด", f"{stats['total_draws']:,}")
m2.metric("ออกบ่อยสุด", f"{stats['most_frequent']} ({stats['most_frequent_count']} ครั้ง)")
m3.metric("เลขที่ไม่เคยออก", f"{len(never_appeared(df, col_name))} เลข")
m4.metric("เลข unique", f"{stats['unique_numbers']}")

st.divider()

# ─── Tabs ─────────────────────────────────────────────────────────────────────
tab1, tab2, tab3, tab4, tab5, tab6, tab7, tab8, tab9, tab10, tab11, tab12, tab13, tab14 = st.tabs([
    "📊 ตารางความถี่",
    "🌡️ ร้อน/เย็น",
    "🗺️ Heat Map",
    "📈 แนวโน้ม",
    "🔢 วิเคราะห์หลัก",
    "📋 ผลย้อนหลัง",
    "⏳ เลขค้าง",
    "🔮 ทำนายงวดหน้า",
    "🔗 เลขคู่",
    "⏭️ ลำดับต่อเนื่อง",
    "📅 เปรียบทศวรรษ",
    "🎫 ตั๋วเสี่ยง",
    "🤖 ML Prediction",
    "🌐 เครือข่ายเลข",
])


# ─── Tab 1: ตารางความถี่ ──────────────────────────────────────────────────────
with tab1:
    col_left, col_right = st.columns([3, 2])

    with col_left:
        st.subheader(f"Top {top_n} เลขออกบ่อย")
        display_df = freq_df.head(top_n).copy()
        display_df.index = range(1, len(display_df) + 1)
        st.dataframe(
            display_df[["เลข", "จำนวนครั้ง", "ออกล่าสุด", "10 งวดล่าสุด"]],
            use_container_width=True,
            column_config={
                "ออกล่าสุด": st.column_config.DateColumn("ออกล่าสุด", format="DD/MM/YYYY"),
                "จำนวนครั้ง": st.column_config.ProgressColumn("จำนวนครั้ง", min_value=0, max_value=int(freq_df["จำนวนครั้ง"].max())),
            }
        )

        # Download
        csv = freq_df.to_csv(index=False, encoding="utf-8-sig")
        st.download_button("⬇️ ดาวน์โหลด CSV", csv, f"lottery_stats_{lottery_type}.csv", "text/csv")

    with col_right:
        st.subheader("Bar Chart")
        fig = px.bar(
            freq_df.head(top_n),
            x="จำนวนครั้ง", y="เลข",
            orientation="h",
            color="จำนวนครั้ง",
            color_continuous_scale="YlOrRd",
            text="จำนวนครั้ง",
        )
        dark_layout(fig, height=400)
        fig.update_layout(yaxis={"categoryorder": "total ascending"}, showlegend=False)
        st.plotly_chart(fig, use_container_width=True)

    # เลขที่ไม่เคยออก
    with st.expander("🚫 เลขที่ไม่เคยออกในช่วงที่เลือก"):
        never = never_appeared(df, col_name)
        if never:
            st.write(", ".join(never))
        else:
            st.write("ออกครบทุกเลขแล้ว!")


# ─── Tab 2: ร้อน/เย็น ────────────────────────────────────────────────────────
with tab2:
    st.subheader("เลขร้อน 🔥 vs เลขเย็น ❄️")
    st.caption("เปรียบเทียบความถี่ล่าสุด 12 เดือน vs ทั้งหมด")

    hc_df = hot_cold_numbers(df, col_name)

    col_hot, col_cold = st.columns(2)
    with col_hot:
        st.markdown("#### 🔥 เลขร้อน (ออกบ่อยกว่าเฉลี่ย)")
        hot = hc_df[hc_df["สถานะ"] == "🔥 ร้อน"].head(10)
        st.dataframe(hot[["เลข", "ทั้งหมด", "ล่าสุด", "สถานะ"]], use_container_width=True, hide_index=True)

    with col_cold:
        st.markdown("#### ❄️ เลขเย็น (ออกน้อยกว่าเฉลี่ย)")
        cold = hc_df[hc_df["สถานะ"] == "❄️ เย็น"].head(10)
        st.dataframe(cold[["เลข", "ทั้งหมด", "ล่าสุด", "สถานะ"]], use_container_width=True, hide_index=True)

    st.subheader("เปรียบเทียบ: ทั้งหมด vs ล่าสุด 12 เดือน")
    fig2 = go.Figure()
    top20 = hc_df.head(20)
    fig2.add_trace(go.Bar(name="ทั้งหมด", x=top20["เลข"], y=top20["ทั้งหมด"], marker_color="#4C78A8"))
    fig2.add_trace(go.Bar(name="ล่าสุด 12 เดือน", x=top20["เลข"], y=top20["ล่าสุด"], marker_color="#F58518"))
    dark_layout(fig2, height=350)
    fig2.update_layout(barmode="group")
    st.plotly_chart(fig2, use_container_width=True)


# ─── Tab 3: Heat Map ─────────────────────────────────────────────────────────
with tab3:
    if col_name in ("top2", "bottom2"):
        st.subheader("Heat Map เลข 00–99")
        st.caption("สีเข้ม = ออกบ่อย | สีอ่อน = ออกน้อย")
        hm = heatmap_data(df, col_name)
        fig3 = px.imshow(
            hm,
            labels={"x": "หลักหน่วย", "y": "หลักสิบ", "color": "ครั้ง"},
            color_continuous_scale="YlOrRd",
            text_auto=True,
            aspect="auto",
        )
        dark_layout(fig3, height=450)
        st.plotly_chart(fig3, use_container_width=True)
    else:
        st.info("Heat Map รองรับเฉพาะ 2 ตัวบน / 2 ตัวล่าง")


# ─── Tab 4: แนวโน้ม ──────────────────────────────────────────────────────────
with tab4:
    st.subheader("แนวโน้มการออกตามปี")
    search_num = st.text_input("ค้นหาเลข (เช่น 79, 053)", max_chars=3)

    if search_num:
        padded = search_num.zfill(2 if col_name in ("top2", "bottom2") else 3)
        trend_df = trend_data(df_raw, col_name, padded)
        if trend_df["ครั้ง"].sum() == 0:
            st.warning(f"เลข {padded} ไม่เคยออกในช่วงที่เลือก")
        else:
            fig4 = px.line(
                trend_df, x="year", y="ครั้ง",
                title=f"ความถี่ของเลข {padded} รายปี",
                markers=True,
            )
            dark_layout(fig4, height=350)
            st.plotly_chart(fig4, use_container_width=True)
            total_times = int(trend_df["ครั้ง"].sum())
            last_year = trend_df[trend_df["ครั้ง"] > 0].iloc[-1]["year"] if trend_df["ครั้ง"].sum() > 0 else "-"
            st.metric("ออกทั้งหมด", f"{total_times} ครั้ง")
            st.metric("ออกล่าสุดปี", int(last_year))

    # ── Comparison mode ──
    st.divider()
    st.subheader("🔍 เปรียบ 2 เลข Side-by-Side")
    cmp_col1, cmp_col2 = st.columns(2)
    with cmp_col1:
        num_a = st.text_input("เลขที่ 1", key="cmp_a", placeholder="เช่น 79")
    with cmp_col2:
        num_b = st.text_input("เลขที่ 2", key="cmp_b", placeholder="เช่น 42")

    if num_a and num_b:
        digits = 2 if col_name in ("top2", "bottom2") else (6 if col_name == "prize1" else 3)
        pad_a = num_a.zfill(digits)
        pad_b = num_b.zfill(digits)
        prof_a = number_profile(df, col_name, pad_a)
        prof_b = number_profile(df, col_name, pad_b)

        labels = ["ออกทั้งหมด (ครั้ง)", "อัตราการออก (%)", "ค้างกี่งวด"]
        vals_a = [prof_a["count"], prof_a["rate"], prof_a["overdue"]]
        vals_b = [prof_b["count"], prof_b["rate"], prof_b["overdue"]]

        col_ca, col_cb, col_cc = st.columns(3)
        for col_c, label, va, vb in zip([col_ca, col_cb, col_cc], labels, vals_a, vals_b):
            with col_c:
                st.markdown(f"**{label}**")
                delta = va - vb if isinstance(va, (int, float)) else None
                st.metric(f"เลข {pad_a}", va, delta=delta if delta else None)
                st.metric(f"เลข {pad_b}", vb)

        # ออกล่าสุด
        la = prof_a["last_date"].strftime("%d/%m/%Y") if prof_a["last_date"] else "ไม่เคยออก"
        lb = prof_b["last_date"].strftime("%d/%m/%Y") if prof_b["last_date"] else "ไม่เคยออก"
        st.caption(f"ออกล่าสุด — {pad_a}: {la} | {pad_b}: {lb}")

        # เปรียบรายเดือน
        month_a = {MONTH_TH.get(k, k): v for k, v in prof_a["month_freq"].items()}
        month_b = {MONTH_TH.get(k, k): v for k, v in prof_b["month_freq"].items()}
        all_months = sorted(set(month_a) | set(month_b))
        if all_months:
            fig_cmp = go.Figure()
            fig_cmp.add_trace(go.Bar(name=f"เลข {pad_a}", x=all_months,
                                     y=[month_a.get(m, 0) for m in all_months], marker_color="#4C78A8"))
            fig_cmp.add_trace(go.Bar(name=f"เลข {pad_b}", x=all_months,
                                     y=[month_b.get(m, 0) for m in all_months], marker_color="#F58518"))
            dark_layout(fig_cmp, height=300, title="ความถี่รายเดือน")
            fig_cmp.update_layout(barmode="group")
            st.plotly_chart(fig_cmp, use_container_width=True)

    # Monthly heatmap
    st.subheader("ความถี่ตามเดือน × ปี (Top เลข)")
    top1_num = freq_df["เลข"].iloc[0] if not freq_df.empty else None
    if top1_num:
        sub = df[df[col_name] == top1_num].copy()
        if not sub.empty:
            pivot = sub.groupby(["year", "month"]).size().reset_index(name="ครั้ง")
            pivot_wide = pivot.pivot(index="year", columns="month", values="ครั้ง").fillna(0)
            pivot_wide.columns = [MONTH_TH.get(c, c) for c in pivot_wide.columns]
            fig5 = px.imshow(
                pivot_wide,
                title=f"การออกของเลข {top1_num} (เดือน × ปี)",
                color_continuous_scale="Blues",
                text_auto=True,
                aspect="auto",
            )
            st.plotly_chart(fig5, use_container_width=True)


# ─── Tab 5: วิเคราะห์หลัก ────────────────────────────────────────────────────
with tab5:
    st.subheader("ความถี่แต่ละหลัก")
    digit_df = digit_frequency(df, col_name)

    positions = digit_df["ตำแหน่ง"].unique()
    cols = st.columns(len(positions))
    for i, pos in enumerate(positions):
        sub = digit_df[digit_df["ตำแหน่ง"] == pos]
        fig6 = px.bar(
            sub, x="เลข", y="จำนวนครั้ง",
            title=f"หลัก{pos}",
            color="จำนวนครั้ง",
            color_continuous_scale="Blues",
        )
        dark_layout(fig6, height=300, title=f"หลัก{pos}")
        fig6.update_layout(showlegend=False)
        with cols[i]:
            st.plotly_chart(fig6, use_container_width=True)

    # ความถี่ตามเดือน
    st.subheader("เลขออกบ่อยที่สุด แต่ละเดือน")
    month_records = []
    for m in range(1, 13):
        sub = df[df["month"] == m]
        if sub.empty:
            continue
        top = sub[col_name].astype(str).replace("", pd.NA).replace("nan", pd.NA).dropna().value_counts()
        if not top.empty:
            month_records.append({
                "เดือน": MONTH_TH[m],
                "เลขออกบ่อยสุด": top.index[0],
                "จำนวนครั้ง": int(top.iloc[0]),
                "อันดับ 2": top.index[1] if len(top) > 1 else "-",
                "อันดับ 3": top.index[2] if len(top) > 2 else "-",
            })
    if month_records:
        st.dataframe(pd.DataFrame(month_records), use_container_width=True, hide_index=True)

    # ความถี่ตามวัน
    st.subheader("เลขออกบ่อยที่สุด แต่ละวันในสัปดาห์")
    day_records = []
    for day in WEEKDAYS:
        sub = df[df["weekday"] == day]
        if sub.empty:
            continue
        top = sub[col_name].astype(str).replace("", pd.NA).replace("nan", pd.NA).dropna().value_counts()
        if not top.empty:
            day_records.append({
                "วัน": day,
                "เลขออกบ่อยสุด": top.index[0],
                "จำนวนครั้ง": int(top.iloc[0]),
            })
    if day_records:
        st.dataframe(pd.DataFrame(day_records), use_container_width=True, hide_index=True)


# ─── Tab 6: ผลย้อนหลัง ────────────────────────────────────────────────────────
with tab6:
    st.subheader("ผลหวยย้อนหลัง")
    n_rows = st.slider("แสดง N งวดล่าสุด", 10, 200, 50)
    display_cols = ["date", "prize1", "top3", "top2", "front3_1", "front3_2", "back3_1", "back3_2", "bottom2"]
    rename_map = {
        "date": "วันที่", "prize1": "รางวัลที่ 1",
        "top3": "3 ตัวบน", "top2": "2 ตัวบน",
        "front3_1": "3 ตัวหน้า (1)", "front3_2": "3 ตัวหน้า (2)",
        "back3_1": "3 ตัวล่าง (1)", "back3_2": "3 ตัวล่าง (2)",
        "bottom2": "2 ตัวล่าง",
    }
    hist = df.sort_values("date", ascending=False).head(n_rows)[display_cols].rename(columns=rename_map)
    st.dataframe(
        hist,
        use_container_width=True,
        hide_index=True,
        column_config={"วันที่": st.column_config.DateColumn("วันที่", format="DD/MM/YYYY")},
    )
    csv2 = hist.to_csv(index=False, encoding="utf-8-sig")
    st.download_button("⬇️ ดาวน์โหลดผลย้อนหลัง", csv2, "lottery_history.csv", "text/csv")


# ─── Tab 7: เลขค้าง ──────────────────────────────────────────────────────────
with tab7:
    st.subheader("⏳ เลขที่ค้างนาน (Overdue Numbers)")
    st.caption("เลขที่ยังไม่ออกมานานที่สุดในช่วงข้อมูลที่เลือก")

    overdue_n = st.slider("แสดงกี่อันดับ", 10, 50, 20, key="overdue_n")
    od_df = overdue_with_prob(df, col_name, top_n=overdue_n)

    col_od1, col_od2 = st.columns([2, 1])
    with col_od1:
        st.dataframe(
            od_df,
            use_container_width=True,
            hide_index=True,
            column_config={
                "ออกล่าสุด": st.column_config.DateColumn("ออกล่าสุด", format="DD/MM/YYYY"),
                "ค้างกี่งวด": st.column_config.ProgressColumn(
                    "ค้างกี่งวด", min_value=0, max_value=int(od_df["ค้างกี่งวด"].max()) if not od_df.empty else 1
                ),
            }
        )

    with col_od2:
        st.markdown("#### สรุป")
        if not od_df.empty:
            never_out = od_df[od_df["ออกทั้งหมด"] == 0]
            st.metric("ไม่เคยออกเลย", f"{len(never_out)} เลข")
            st.metric("ค้างนานสุด", f"{int(od_df['ค้างกี่งวด'].iloc[0])} งวด")
            st.metric("เลขค้างนานสุด", od_df["เลข"].iloc[0])

        # Bar chart
        fig_od = px.bar(
            od_df.head(15),
            x="เลข", y="ค้างกี่งวด",
            color="ค้างกี่งวด",
            color_continuous_scale="Reds",
            title="Top 15 เลขค้างนาน",
        )
        dark_layout(fig_od, height=300, title="Top 15 เลขค้างนาน")
        fig_od.update_layout(showlegend=False)
        st.plotly_chart(fig_od, use_container_width=True)


# ─── Tab 8: ทำนายงวดหน้า ─────────────────────────────────────────────────────
with tab8:
    st.subheader("🔮 ทำนายเลขสำหรับงวดอนาคต")
    st.warning("⚠️ การวิเคราะห์ทางสถิติเท่านั้น ไม่ใช่การพยากรณ์ที่แน่นอน")

    # ── เลือกงวด ──
    upcoming = next_thai_draw(datetime.now())
    draw_options = {f"{d['day']} {MONTH_TH.get(d['month'], '')} {d['year']+543} (วัน{d['weekday']})": d["date"] for d in upcoming}

    col_p1, col_p2 = st.columns([2, 1])
    with col_p1:
        selected_draw_label = st.selectbox("เลือกงวดที่ต้องการทำนาย", list(draw_options.keys()))
        selected_draw_date = draw_options[selected_draw_label]
    with col_p2:
        pred_n = st.slider("แสดง Top N เลข", 5, 20, 10, key="pred_n")

    # ── Confidence banner ──
    conf = prediction_confidence(df_raw, col_name, selected_draw_date)
    st.markdown(
        f'<div class="mini-card" style="border-left-color:{conf["color"]};margin-bottom:10px">'
        f'<b style="color:{conf["color"]}">ความมั่นใจ: {conf["label"]}</b>'
        f'&nbsp;&nbsp;<span style="color:#aaa;font-size:.85rem">'
        f'มีงวดตรงนี้ {conf["n_same_day_month"]} งวด · '
        f'งวดวันที่นี้ {conf["n_same_day"]} งวด · '
        f'งวดเดือนนี้ {conf["n_same_month"]} งวด</span></div>',
        unsafe_allow_html=True,
    )
    st.info(f"กำลังทำนาย: **{lottery_type}** สำหรับงวด **{selected_draw_label}**")

    # ── Prize1 (6-digit) — special prediction path ──
    _digits_pred = 2 if col_name in ("top2", "bottom2") else (6 if col_name == "prize1" else 3)

    if col_name == "prize1":
        st.subheader("🎯 ทำนายรางวัลที่ 1 (6 หลัก)")

        # ── Version selector ──
        _vcol1, _vcol2 = st.columns([2, 2])
        with _vcol1:
            _p1_ver = st.radio(
                "Algorithm",
                ["v4 Trigram+Ensemble (แนะนำ)", "v3 Hybrid", "v2 Beam Search", "v1 Front3×Back3"],
                horizontal=True, key="p1_ver",
            )
        # Defaults (avoid NameError when branch doesn't define a var)
        _bw, _kbk, _p1k = 200, 50, 20

        with _vcol2:
            if _p1_ver in ("v4 Trigram+Ensemble (แนะนำ)", "v3 Hybrid"):
                _bw  = st.slider("Beam width (front3)", 50, 500, 200, step=50, key="p1_beam")
                _kbk = st.slider("k_back (top3 candidates)", 20, 100, 50, step=10, key="p1_kback")
            elif _p1_ver == "v2 Beam Search":
                _bw  = st.slider("Beam width", 50, 500, 200, step=50, key="p1_beam_v2")
            else:
                _p1k = st.slider("Top-K ต่อครึ่ง (pool = K²)", 10, 30, 20, key="p1k")

        # Algorithm descriptions
        _desc = {
            "v4 Trigram+Ensemble (แนะนำ)": (
                "**Front3**: Trigram P(d2|d0,d1) + 3-config ensemble beam (trig/balanced/pair-heavy)  "
                "**Back3**: full 10-signal top3 predictor  "
                "**Junction**: 0.6×P(d3|d2) + 0.4×P(d3|d1,d2) extended trigram across seam"
            ),
            "v3 Hybrid": (
                "**Front3**: Beam search pos 0-2 + bigram pair transitions  "
                "**Back3**: full 10-signal top3 predictor (top k_back candidates)  "
                "**Junction**: P(back3[0] | front3[2]) bigram"
            ),
            "v2 Beam Search": (
                "Beam search 6 positions + pair transitions + digit-sum filter  "
                "Blends 70% beam + 30% v1 Front3×Back3"
            ),
            "v1 Front3×Back3": (
                "Cross-product K² candidates + per-position digit freq re-ranking  "
                "Original decomposition algorithm"
            ),
        }
        st.caption(_desc[_p1_ver])

        with st.spinner("กำลังประมวลผล…"):
            if _p1_ver == "v4 Trigram+Ensemble (แนะนำ)":
                p1_df = predict_prize1_v4(
                    df_raw, selected_draw_date,
                    top_n=pred_n * 2, beam_width=_bw, k_back=_kbk, n_ensemble=3,
                )
                _score_cols = ["เลข", "หน้า 3", "หลัง 3", "Digit Sum",
                               "Front Beam", "Back Top3", "Junction", "คะแนนรวม"]
                _pool_label = f"3-ensemble Beam {_bw} × k_back {_kbk}"
            elif _p1_ver == "v3 Hybrid":
                p1_df = predict_prize1_v3(
                    df_raw, selected_draw_date,
                    top_n=pred_n * 2, beam_width=_bw, k_back=_kbk,
                )
                _score_cols = ["เลข", "หน้า 3", "หลัง 3", "Digit Sum",
                               "Front Beam", "Back Top3", "Junction", "คะแนนรวม"]
                _pool_label = f"Beam {_bw} × k_back {_kbk} = {_bw * _kbk:,} cross-products"
            elif _p1_ver == "v2 Beam Search":
                p1_df = predict_prize1_v2(
                    df_raw, selected_draw_date,
                    top_n=pred_n * 2, beam_width=_bw, blend_v1=True, k_per_half=15,
                )
                _score_cols = ["เลข", "หน้า 3", "หลัง 3", "Digit Sum", "Beam", "V1 blend", "คะแนนรวม"]
                _pool_label = f"Beam width {_bw} candidates"
            else:
                p1_df = predict_prize1(
                    df_raw, selected_draw_date, top_n=pred_n * 2, k_per_half=_p1k,
                )
                _score_cols = ["เลข", "หน้า 3", "หลัง 3", "คะแนนรวม"]
                _pool_label = f"{_p1k}² = {_p1k*_p1k} candidates"

        if not p1_df.empty:
            top3_p1 = p1_df.head(3)
            badge_html = "".join(
                f'<span class="num-badge" style="font-size:1.1rem;letter-spacing:2px">'
                f'{row["เลข"][:3]}<span style="color:#f5e642">·</span>{row["เลข"][3:]}</span>'
                for _, row in top3_p1.iterrows()
            )
            st.markdown(
                f'<div style="text-align:center;margin:12px 0">'
                f'<div style="color:#aaa;font-size:.85rem;margin-bottom:8px">'
                f'🎲 Top 3 — {_pool_label}</div>'
                f'{badge_html}</div>',
                unsafe_allow_html=True,
            )

            _show_cols = [c for c in _score_cols if c in p1_df.columns]
            _col_cfg: dict = {
                "คะแนนรวม": st.column_config.ProgressColumn(
                    "คะแนนรวม", min_value=0,
                    max_value=float(p1_df["คะแนนรวม"].max()),
                ),
            }
            for _fc in ("Front Beam", "Back Top3", "Junction", "Beam", "V1 blend"):
                if _fc in p1_df.columns:
                    _col_cfg[_fc] = st.column_config.NumberColumn(_fc, format="%.3f")
            st.dataframe(
                p1_df[_show_cols].head(pred_n),
                use_container_width=True,
                column_config=_col_cfg,
            )

            # ── Digit sum distribution context ──
            with st.expander("📊 Digit Sum Distribution"):
                prize1_valid = df_raw[
                    df_raw["prize1"].notna() &
                    (df_raw["prize1"].str.len() == 6) &
                    ~df_raw["prize1"].isin(("", "nan"))
                ].copy()
                if not prize1_valid.empty:
                    prize1_valid["_ds"] = prize1_valid["prize1"].apply(
                        lambda x: sum(int(c) for c in str(x)[:6] if c.isdigit())
                    )
                    ds_counts = prize1_valid["_ds"].value_counts().sort_index().reset_index()
                    ds_counts.columns = ["Digit Sum", "ครั้ง"]
                    fig_ds = px.bar(ds_counts, x="Digit Sum", y="ครั้ง",
                                   title="Digit Sum (ผลรวม 6 หลัก) — ประวัติทั้งหมด")
                    dark_layout(fig_ds, height=260)
                    st.plotly_chart(fig_ds, use_container_width=True)
                    cand_ds = p1_df.head(pred_n)["Digit Sum"].values if "Digit Sum" in p1_df.columns else []
                    if len(cand_ds):
                        st.caption(
                            f"Top {pred_n} candidates — Digit Sum range: "
                            f"{int(min(cand_ds))}–{int(max(cand_ds))}, "
                            f"ค่าเฉลี่ยประวัติ: {prize1_valid['_ds'].mean():.1f}"
                        )

        # ── Backtest ──
        with st.expander("🧪 Backtest — วัด Hit Rate จริง (out-of-sample)"):
            st.caption(
                "รัน backtest บน N งวดล่าสุด โดยใช้ข้อมูลก่อนงวดนั้นเท่านั้น (ไม่ data leakage)  "
                "Hit = prize1 จริงอยู่ใน Top-N pool ที่ algorithm แนะนำ"
            )
            _bt_col1, _bt_col2, _bt_col3 = st.columns(3)
            with _bt_col1:
                _bt_n    = st.slider("จำนวนงวด backtest", 10, 100, 30, step=10, key="bt_n")
            with _bt_col2:
                _bt_topn = st.slider("Top-N pool", 10, 50, 20, step=5, key="bt_topn")
            with _bt_col3:
                _bt_algo = st.selectbox("Algorithm", ["v4", "v3", "v2", "v1"], key="bt_algo")
            _bt_compare_v1 = st.checkbox("เปรียบกับ v1 baseline", value=False, key="bt_cmp_v1",
                                         help="เปิดเพื่อรัน v1 ควบคู่ (ช้ากว่า ~2x)")

            _bt_beam = min(_bw, 100)
            _bt_kback = min(_kbk, 30)
            if st.button("▶ รัน Backtest", key="bt_run",
                         help=f"beam cap'd ที่ {_bt_beam} (จาก {_bw}), k_back cap'd ที่ {_bt_kback} (จาก {_kbk}) เพื่อความเร็ว"):
                with st.spinner(f"Backtest {_bt_n} งวด — อาจใช้เวลา 30-120 วินาที…"):
                    _bt_res = prize1_backtest(
                        df_raw, n_draws=_bt_n, top_n=_bt_topn,
                        beam_width=_bt_beam, k_back=_bt_kback,
                        algorithm=_bt_algo,
                        compare_v1=_bt_compare_v1,
                    )

                if _bt_compare_v1:
                    _bt_m1, _bt_m2, _bt_m3, _bt_m4 = st.columns(4)
                    _bt_m3 = _bt_m3
                else:
                    _bt_m1, _bt_m2, _bt_m4 = st.columns(3)
                    _bt_m3 = None
                _bt_m1.metric("งวดที่ทดสอบ", _bt_res["n_tested"])
                _bt_m2.metric(
                    f"Hits ({_bt_algo})",
                    _bt_res["hits_algo"],
                    f"{_bt_res['rate_algo']*100:.2f}%",
                )
                if _bt_m3 is not None:
                    _bt_m3.metric(
                        "Hits (v1 baseline)",
                        _bt_res["hits_v1"],
                        f"{_bt_res['rate_v1']*100:.2f}%",
                    )
                _bt_m4.metric(
                    "Random baseline",
                    f"{_bt_res['random_rate']*100:.4f}%",
                    f"Lift {_bt_res['lift_algo']:.0f}x",
                )
                _bt_caption = (
                    f"Pool {_bt_topn} candidates / 1,000,000 → random {_bt_topn/1e6*100:.4f}%  "
                    f"| {_bt_algo} lift vs random: **{_bt_res['lift_algo']:.0f}x**  "
                    f"| params: beam={_bt_beam}, k_back={_bt_kback}"
                )
                if _bt_compare_v1:
                    _bt_caption += f"  | v1 lift vs random: **{_bt_res['lift_v1']:.0f}x**"
                st.caption(_bt_caption)
                if _bt_res["n_tested"] < 50:
                    st.warning(
                        f"⚠️ n={_bt_res['n_tested']} งวดน้อยเกินไปสำหรับ pool {_bt_topn}/1,000,000 "
                        f"— lift อาจเป็น noise เพิ่มเป็น ≥100 งวดเพื่อผลที่น่าเชื่อถือ"
                    )
                if _bt_res.get("errors", 0) > 0:
                    st.error(
                        f"❌ {_bt_res['errors']} iteration ล้มเหลว — ดู Streamlit log สำหรับรายละเอียด"
                    )

        # ── Digit frequency analysis per position ──
        with st.expander("🔢 วิเคราะห์ความถี่เลขแต่ละตำแหน่ง (Digit-Position Analysis)"):
            da_df = prize1_digit_analysis(df_raw, selected_draw_date)
            if not da_df.empty:
                pos_options = da_df["ตำแหน่ง"].unique().tolist()
                sel_pos = st.selectbox("เลือกตำแหน่ง", pos_options, key="da_pos")
                pos_data = da_df[da_df["ตำแหน่ง"] == sel_pos].copy()

                _pc1, _pc2 = st.columns([2, 3])
                with _pc1:
                    st.dataframe(
                        pos_data[["เลข", "ออกทั้งหมด", "% ทั้งหมด",
                                  "ออกงวดนี้ (วัน/เดือน)", "สถานะ"]],
                        use_container_width=True, hide_index=True,
                    )
                with _pc2:
                    fig_da = px.bar(
                        pos_data, x="เลข", y="ออกทั้งหมด",
                        color="สถานะ",
                        color_discrete_map={"🔥 ร้อน": "#f5e642", "❄️ เย็น": "#4cc9f0", "➡️ ปกติ": "#aaa"},
                        title=f"ความถี่เลข ตำแหน่ง {sel_pos}",
                        text="ออกทั้งหมด",
                    )
                    dark_layout(fig_da, height=320)
                    st.plotly_chart(fig_da, use_container_width=True)

                # Hot digits summary across all positions
                st.markdown("**เลขแนะนำต่อตำแหน่ง (เรียงจากความถี่งวดวัน/เดือนนี้):**")
                hot_html = ""
                for pos_name in pos_options:
                    sub = da_df[da_df["ตำแหน่ง"] == pos_name].sort_values(
                        "ออกงวดนี้ (วัน/เดือน)", ascending=False
                    ).head(3)
                    top_digits = " / ".join(sub["เลข"].tolist())
                    hot_html += (
                        f'<span style="color:#aaa;font-size:.8rem">{pos_name[:2]}</span>'
                        f'<span class="num-badge" style="margin:2px 6px">{top_digits}</span>'
                    )
                st.markdown(f'<div style="margin:8px 0">{hot_html}</div>', unsafe_allow_html=True)

        st.divider()

    # ── Ensemble (ML + สถิติ) for 2/3-digit types ──
    _use_ml = model_exists(col_name) and _digits_pred < 6
    _ml_df_pred = pd.DataFrame()
    if _use_ml:
        try:
            _ml_df_pred = predict_ml(df_raw, col_name, selected_draw_date, top_n=pred_n * 3)
        except Exception:
            _ml_df_pred = pd.DataFrame()

    ens_df = ensemble_predict(
        df_raw, col_name, selected_draw_date,
        ml_df=_ml_df_pred if not _ml_df_pred.empty else None,
        top_n=pred_n,
    )

    # ── Top badges (for 2/3-digit only) ──
    if not ens_df.empty and col_name != "prize1":
        top5_ens = ens_df.head(5)
        badge_html = "".join(
            f'<span class="num-badge"'
            f'{"style=\'border-color:#54a24b;color:#54a24b\'" if row["แหล่ง"].startswith("🤝") else ""}>'
            f'{row["แหล่ง"].split()[0]} {row["เลข"]}</span>'
            for _, row in top5_ens.iterrows()
        )
        mode_label = "🤝 Ensemble (ML + สถิติ)" if (_use_ml and not _ml_df_pred.empty) else "📊 สถิติ"
        st.markdown(
            f'<div style="text-align:center;margin:12px 0 8px">'
            f'<div style="color:#aaa;font-size:.85rem;margin-bottom:8px">{mode_label} — Top 5 เลขแนะนำ</div>'
            f'{badge_html}</div>',
            unsafe_allow_html=True,
        )
        st.dataframe(
            ens_df,
            use_container_width=True,
            column_config={
                "คะแนนรวม": st.column_config.ProgressColumn(
                    "คะแนนรวม", min_value=0,
                    max_value=float(ens_df["คะแนนรวม"].max()) if not ens_df.empty else 1,
                ),
                "สถิติ (%)": st.column_config.NumberColumn("สถิติ (%)", format="%.1f"),
                "ML (%)": st.column_config.NumberColumn("ML (%)", format="%.1f"),
            },
        )
    elif not ens_df.empty and col_name == "prize1":
        # For prize1: show ensemble as secondary reference only
        with st.expander("📊 สถิติ Ensemble (รายการเลขที่เคยออก)", expanded=False):
            st.caption("เนื่องจาก prize1 ไม่ซ้ำเกือบทุกงวด ตารางนี้แสดงเพื่ออ้างอิงเท่านั้น")
            st.dataframe(ens_df, use_container_width=True)

    st.divider()

    # ── Statistical detail + radar ──
    with st.expander("📊 รายละเอียดสถิติ (Statistical breakdown)"):
        pred_df = predict_with_reasons(df_raw, col_name, selected_draw_date, top_n=pred_n)
        st.markdown("**เหตุผลของแต่ละเลข:**")
        for _, row in pred_df.head(5).iterrows():
            tags = "".join(f'<span class="reason-tag">{t.strip()}</span>'
                           for t in row["เหตุผล"].split("·") if t.strip())
            st.markdown(
                f'<div class="mini-card"><b style="color:#f5e642;font-size:1.1rem">{row["เลข"]}</b>'
                f'&nbsp;&nbsp;{tags}&nbsp;&nbsp;'
                f'<span style="color:#888;font-size:.8rem">คะแนน {row["คะแนนรวม"]}</span></div>',
                unsafe_allow_html=True,
            )

        col_t1, col_t2 = st.columns([3, 2])
        with col_t1:
            weekday_col = [c for c in pred_df.columns if c.startswith("วัน") and c not in ("วัน+เดือนเดียวกัน", "วันที่เดียวกัน")]
            display_pred_cols = ["เลข", "สถานะ", "คะแนนรวม", "วัน+เดือนเดียวกัน", "วันที่เดียวกัน", "เดือนเดียวกัน", "รวมทั้งหมด", "ค้างกี่งวด", "เหตุผล"]
            if weekday_col:
                display_pred_cols.insert(4, weekday_col[0])
            valid_cols = [c for c in display_pred_cols if c in pred_df.columns]
            st.dataframe(
                pred_df[valid_cols], use_container_width=True,
                column_config={"คะแนนรวม": st.column_config.ProgressColumn(
                    "คะแนนรวม", min_value=0,
                    max_value=float(pred_df["คะแนนรวม"].max()) if not pred_df.empty else 1,
                )},
            )
        with col_t2:
            if len(pred_df) >= 3:
                categories = ["วัน+เดือนเดียวกัน", "วันที่เดียวกัน", "เดือนเดียวกัน", "รวมทั้งหมด"]
                fig_radar = go.Figure()
                _radar_colors = ["#f5e642", "#ff6b35", "#4cc9f0", "#54a24b", "#b279a2"]
                for i, (_, row) in enumerate(pred_df.head(5).iterrows()):
                    vals = [row.get(c, 0) for c in categories]
                    max_val = max(vals) if max(vals) > 0 else 1
                    vals_norm = [v / max_val for v in vals]
                    fig_radar.add_trace(go.Scatterpolar(
                        r=vals_norm + [vals_norm[0]], theta=categories + [categories[0]],
                        name=str(row["เลข"]), mode="lines+markers",
                        line=dict(color=_radar_colors[i % len(_radar_colors)], width=2),
                        marker=dict(size=6),
                    ))
                fig_radar.update_layout(
                    polar=dict(radialaxis=dict(visible=True, range=[0, 1], gridcolor="#333"), bgcolor="#1a1a2e"),
                    paper_bgcolor="#0e1117", font=dict(color="#fafafa"),
                    showlegend=True, height=350, title="เปรียบเทียบ Top 5",
                )
                st.plotly_chart(fig_radar, use_container_width=True)

    # ── Back-test ──
    with st.expander("📊 Back-test — ทดสอบความแม่นยำของ algorithm"):
        bt_n = st.slider("ทดสอบกี่งวดย้อนหลัง", 10, 100, 30, key="gen_bt_n")
        if st.button("รัน Back-test", key="gen_bt_run"):
            df_bt = df_raw.sort_values("date").reset_index(drop=True)
            if len(df_bt) <= bt_n:
                st.warning("ข้อมูลไม่พอ")
            else:
                hits_top1, hits_top3, hits_top5 = 0, 0, 0
                test_rows = []
                bt_progress = st.progress(0, text="กำลัง back-test...")
                bt_start = len(df_bt) - bt_n
                for i in range(bt_start, len(df_bt)):
                    bt_row = df_bt.iloc[i]
                    bt_progress.progress((i - bt_start + 1) / bt_n, text=f"Back-test {i - bt_start + 1}/{bt_n}...")
                    train = df_bt.iloc[:i]
                    if train.empty:
                        continue
                    pred = predict_numbers(train, col_name, bt_row["date"], top_n=5)
                    actual = str(bt_row[col_name])
                    pred_list = pred["เลข"].tolist()
                    h1 = actual in pred_list[:1]
                    h3 = actual in pred_list[:3]
                    h5 = actual in pred_list[:5]
                    if h1: hits_top1 += 1
                    if h3: hits_top3 += 1
                    if h5: hits_top5 += 1
                    test_rows.append({
                        "วันที่": bt_row["date"].strftime("%d/%m/%Y"),
                        "เลขจริง": actual,
                        "Top5 ทำนาย": " / ".join(str(p) for p in pred_list),
                        "แม่น Top1": "✅" if h1 else "❌",
                        "แม่น Top3": "✅" if h3 else "❌",
                        "แม่น Top5": "✅" if h5 else "❌",
                    })
                bt_progress.empty()
                total = len(test_rows)
                bta, btb, btc = st.columns(3)
                bta.metric("แม่น Top 1", f"{hits_top1}/{total} ({hits_top1/total*100:.1f}%)")
                btb.metric("แม่น Top 3", f"{hits_top3}/{total} ({hits_top3/total*100:.1f}%)")
                btc.metric("แม่น Top 5", f"{hits_top5}/{total} ({hits_top5/total*100:.1f}%)")
                if test_rows:
                    st.dataframe(pd.DataFrame(test_rows), use_container_width=True, hide_index=True)

    # ── ข้อมูลอ้างอิงงวดที่เลือก ──
    st.divider()
    st.subheader("ข้อมูลอ้างอิงสำหรับงวดนี้")
    mask_day = df_raw["day"] == selected_draw_date.day
    mask_month = df_raw["month"] == selected_draw_date.month
    mask_wd = df_raw["weekday"] == DAY_MAP.get(selected_draw_date.weekday(), "")
    ctx_cols = st.columns(3)
    with ctx_cols[0]:
        st.metric(f"งวดวันที่ {selected_draw_date.day} ทั้งหมด", f"{mask_day.sum()} งวด")
    with ctx_cols[1]:
        st.metric(f"งวดเดือน {MONTH_TH.get(selected_draw_date.month, '')} ทั้งหมด", f"{mask_month.sum()} งวด")
    with ctx_cols[2]:
        wd_name = DAY_MAP.get(selected_draw_date.weekday(), "")
        st.metric(f"งวดวัน{wd_name}ทั้งหมด", f"{mask_wd.sum()} งวด")

    same_draws = df_raw[mask_day & mask_month].sort_values("date", ascending=False)
    if not same_draws.empty:
        st.subheader(f"ผลย้อนหลัง: งวดวันที่ {selected_draw_date.day} เดือน {MONTH_TH.get(selected_draw_date.month, '')}")
        rename_pred = {
            "date": "วันที่", "prize1": "รางวัลที่ 1",
            "top3": "3 ตัวบน", "top2": "2 ตัวบน",
            "front3_1": "3 ตัวหน้า (1)", "front3_2": "3 ตัวหน้า (2)",
            "back3_1": "3 ตัวล่าง (1)", "back3_2": "3 ตัวล่าง (2)",
            "bottom2": "2 ตัวล่าง",
        }
        show_cols = ["date", "prize1", "top3", "top2", "front3_1", "front3_2", "back3_1", "back3_2", "bottom2"]
        st.dataframe(
            same_draws[show_cols].rename(columns=rename_pred),
            use_container_width=True, hide_index=True,
            column_config={"วันที่": st.column_config.DateColumn("วันที่", format="DD/MM/YYYY")},
        )


# ─── Tab 9: เลขคู่ (Pair Analysis) ──────────────────────────────────────────
with tab9:
    st.subheader("🔗 เลขคู่ — Cross-Type Correlation")
    st.caption("ถ้า [ประเภท A] ออกเลขนี้ → [ประเภท B] มักออกอะไร")

    pair_col_left, pair_col_right = st.columns(2)
    with pair_col_left:
        pair_type_a = st.selectbox("ประเภท A (เลขที่รู้)", list(LOTTERY_TYPES.keys()), key="pair_a")
        pair_col_a = LOTTERY_TYPES[pair_type_a]
    with pair_col_right:
        pair_type_b = st.selectbox("ประเภท B (อยากรู้)", list(LOTTERY_TYPES.keys()), index=2, key="pair_b")
        pair_col_b = LOTTERY_TYPES[pair_type_b]

    digits_a = 2 if pair_col_a in ("top2", "bottom2") else (6 if pair_col_a == "prize1" else 3)
    query_pair = st.text_input(f"ใส่เลข {pair_type_a}", key="query_pair",
                                placeholder=f"{'00' if digits_a == 2 else '000'}")

    if query_pair:
        padded_q = query_pair.zfill(digits_a)
        st.info(f"ถ้า {pair_type_a} = **{padded_q}** → {pair_type_b} มักออก...")
        pair_df = pair_analysis(df, pair_col_a, pair_col_b, padded_q, top_n=top_n)
        if pair_df.empty:
            st.warning(f"เลข {padded_q} ไม่เคยออกใน {pair_type_a}")
        else:
            pa_left, pa_right = st.columns([2, 1])
            with pa_left:
                st.dataframe(pair_df, use_container_width=True, hide_index=True,
                             column_config={"เปอร์เซ็นต์": st.column_config.ProgressColumn(
                                 "เปอร์เซ็นต์", min_value=0, max_value=100)})
            with pa_right:
                fig_pair = px.bar(pair_df, x="เลข", y="จำนวนครั้ง",
                                  color="จำนวนครั้ง", color_continuous_scale="Oranges",
                                  title=f"Top {pair_type_b} เมื่อ {pair_type_a}={padded_q}")
                dark_layout(fig_pair, height=350)
                fig_pair.update_layout(showlegend=False)
                st.plotly_chart(fig_pair, use_container_width=True)
    else:
        # แสดง top pairs ทั้งหมด (same type lag-0 = cross-type)
        st.info("พิมพ์เลขด้านบนเพื่อดู correlation")
        if pair_col_a != pair_col_b:
            # quick overview: top 5 ของ A → top 3 ที่พบบ่อยใน B
            top5_a = freq_table(df, pair_col_a)["เลข"].head(5).tolist()
            overview_rows = []
            for num in top5_a:
                p_df = pair_analysis(df, pair_col_a, pair_col_b, str(num), top_n=3)
                top3 = " / ".join(p_df["เลข"].tolist()) if not p_df.empty else "-"
                overview_rows.append({f"{pair_type_a}": num, f"Top 3 {pair_type_b}": top3})
            if overview_rows:
                st.subheader(f"Overview: Top 5 เลข {pair_type_a} → มักพบ {pair_type_b}")
                st.dataframe(pd.DataFrame(overview_rows), use_container_width=True, hide_index=True)


# ─── Tab 10: ลำดับต่อเนื่อง (Consecutive Pattern) ────────────────────────────
with tab10:
    st.subheader("⏭️ ลำดับต่อเนื่อง (Lag-1 Pattern)")
    st.caption("งวดก่อนออกเลขนี้ → งวดถัดมามักออกอะไร")

    dig_curr = 2 if col_name in ("top2", "bottom2") else (6 if col_name == "prize1" else 3)
    seq_query = st.text_input(f"เลขงวดก่อนหน้า ({lottery_type})", key="seq_q",
                               placeholder=f"{'00' if dig_curr == 2 else '000'}")

    if seq_query:
        padded_seq = seq_query.zfill(dig_curr)
        st.info(f"หลังจาก {padded_seq} ออก → งวดถัดมามักออก...")
        seq_df = consecutive_pattern(df, col_name, padded_seq, top_n=top_n)
        if seq_df.empty:
            st.warning(f"เลข {padded_seq} ไม่เคยออก หรือข้อมูลไม่พอ")
        else:
            s_left, s_right = st.columns([2, 1])
            with s_left:
                st.dataframe(seq_df, use_container_width=True, hide_index=True,
                             column_config={"เปอร์เซ็นต์": st.column_config.ProgressColumn(
                                 "เปอร์เซ็นต์", min_value=0, max_value=100)})
            with s_right:
                fig_seq = px.bar(seq_df, x="เลขตามมา", y="จำนวนครั้ง",
                                 color="จำนวนครั้ง", color_continuous_scale="Purples",
                                 title=f"หลัง {padded_seq} มักออก...")
                dark_layout(fig_seq, height=350)
                fig_seq.update_layout(showlegend=False)
                st.plotly_chart(fig_seq, use_container_width=True)
    else:
        st.subheader(f"Top คู่ที่ออกติดต่อกันบ่อยสุด ({lottery_type})")
        top_pairs_df = consecutive_pattern(df, col_name, top_n=15)
        if not top_pairs_df.empty:
            st.dataframe(top_pairs_df, use_container_width=True, hide_index=True)
            fig_top_pairs = px.bar(top_pairs_df, x="คู่เลข (ก่อน→ตาม)", y="จำนวนครั้ง",
                                   color="จำนวนครั้ง", color_continuous_scale="Purples")
            dark_layout(fig_top_pairs, height=350)
            fig_top_pairs.update_layout(showlegend=False)
            st.plotly_chart(fig_top_pairs, use_container_width=True)


# ─── Tab 11: เปรียบทศวรรษ ────────────────────────────────────────────────────
with tab11:
    st.subheader("📅 เปรียบเลขยอดนิยมระหว่างทศวรรษ")
    st.caption("1994–2004 vs 2005–2014 vs 2015–2026 — เลขที่ hot เปลี่ยนไปไหม?")

    decade_df = decade_comparison(df, col_name, top_n=15)

    _end_year = df["year"].max() if not df.empty else 2026
    era_labels = ["1994–2004", "2005–2014", f"2015–{_end_year}"]

    # stacked bar
    fig_dec = go.Figure()
    colors = ["#4C78A8", "#F58518", "#54A24B"]
    for era, color in zip(era_labels, colors):
        if era in decade_df.columns:
            fig_dec.add_trace(go.Bar(
                name=era, x=decade_df["เลข"], y=decade_df[era], marker_color=color
            ))
    dark_layout(fig_dec, height=420, title=f"ความถี่ {lottery_type} แยกตามช่วงปี")
    fig_dec.update_layout(barmode="group", xaxis_title="เลข", yaxis_title="จำนวนครั้ง")
    st.plotly_chart(fig_dec, use_container_width=True)

    st.dataframe(decade_df, use_container_width=True, hide_index=True,
                 column_config={era: st.column_config.ProgressColumn(
                     era, min_value=0, max_value=int(decade_df[era].max()) if era in decade_df else 1
                 ) for era in era_labels if era in decade_df.columns})

    # หา "ดาวรุ่ง" — เลขที่ era ล่าสุด hot กว่า era เก่า
    _latest_era = era_labels[2]
    if all(e in decade_df.columns for e in era_labels):
        rising = decade_df[decade_df[_latest_era] > decade_df["1994–2004"]].head(5)
        falling = decade_df[decade_df[_latest_era] < decade_df["1994–2004"]].head(5)

        col_rise, col_fall = st.columns(2)
        with col_rise:
            st.markdown("#### 📈 ดาวรุ่ง (ออกบ่อยขึ้นในยุคล่าสุด)")
            if not rising.empty:
                st.dataframe(rising[["เลข", "1994–2004", "2005–2014", _latest_era]],
                             use_container_width=True, hide_index=True)
        with col_fall:
            st.markdown("#### 📉 ดาวร่วง (ออกน้อยลงในยุคล่าสุด)")
            if not falling.empty:
                st.dataframe(falling[["เลข", "1994–2004", "2005–2014", _latest_era]],
                             use_container_width=True, hide_index=True)


# ─── Tab 12: ตั๋วเสี่ยง ──────────────────────────────────────────────────────
with tab12:
    st.subheader("🎫 ตั๋วเสี่ยง — วิเคราะห์เลขที่คุณเลือก")
    st.caption("เลือกเลขที่สนใจแล้วดูสถิติรวม ออกบ่อยไหม ค้างนานไหม")

    # session state สำหรับเก็บเลขที่เลือก
    if "ticket_nums" not in st.session_state:
        st.session_state.ticket_nums = []

    # ── Input ──
    tk_col1, tk_col2, tk_col3 = st.columns([2, 1, 1])
    with tk_col1:
        digits_tk = 2 if col_name in ("top2", "bottom2") else (6 if col_name == "prize1" else 3)
        tk_input = st.text_input(
            f"ใส่เลข ({digits_tk} หลัก)",
            max_chars=digits_tk, key="tk_input",
            placeholder=f"เช่น {'79' if digits_tk==2 else ('053' if digits_tk==3 else '123456')}"
        )
    with tk_col2:
        if st.button("➕ เพิ่มเลข", use_container_width=True):
            padded = tk_input.strip().zfill(digits_tk)
            if padded and padded not in st.session_state.ticket_nums and len(padded) == digits_tk:
                st.session_state.ticket_nums.append(padded)
                st.rerun()
    with tk_col3:
        if st.button("🗑️ ล้างทั้งหมด", use_container_width=True):
            st.session_state.ticket_nums = []
            st.rerun()

    # ── Quick-pick popular numbers ──
    if not st.session_state.ticket_nums:
        st.markdown("**หรือเลือกจาก top 10 เลขออกบ่อย:**")
        top10 = freq_table(df, col_name)["เลข"].head(10).tolist()
        qp_cols = st.columns(10)
        for i, num in enumerate(top10):
            with qp_cols[i]:
                if st.button(str(num), key=f"qp_{num}", use_container_width=True):
                    if str(num) not in st.session_state.ticket_nums:
                        st.session_state.ticket_nums.append(str(num))
                    st.rerun()

    # ── Display selected ticket ──
    if st.session_state.ticket_nums:
        st.markdown("---")
        # แสดง badge ของเลขที่เลือก
        badge_html = "".join(
            f'<span class="num-badge">{n}</span>'
            for n in st.session_state.ticket_nums
        )
        st.markdown(f'<div style="text-align:center;margin:10px 0">{badge_html}</div>',
                    unsafe_allow_html=True)

        # วิเคราะห์แต่ละเลข
        tk_df = ticket_analysis(df, col_name, st.session_state.ticket_nums)
        st.dataframe(
            tk_df,
            use_container_width=True, hide_index=True,
            column_config={
                "อัตรา (%)": st.column_config.ProgressColumn(
                    "อัตรา (%)", min_value=0,
                    max_value=float(tk_df["อัตรา (%)"].max()) if not tk_df.empty else 1
                ),
            }
        )

        # Summary
        avg_rate = tk_df["อัตรา (%)"].mean()
        most_overdue = tk_df.loc[tk_df["ค้างกี่งวด"].idxmax()]
        most_freq = tk_df.loc[tk_df["ออกทั้งหมด"].idxmax()]

        sc1, sc2, sc3 = st.columns(3)
        sc1.metric("อัตราออกเฉลี่ย (ทุกเลข)", f"{avg_rate:.2f}%")
        sc2.metric("เลขค้างนานสุดในกลุ่ม", f"{most_overdue['เลข']} ({int(most_overdue['ค้างกี่งวด'])} งวด)")
        sc3.metric("เลขออกบ่อยสุดในกลุ่ม", f"{most_freq['เลข']} ({int(most_freq['ออกทั้งหมด'])} ครั้ง)")

        # แสดงผลย้อนหลังสำหรับแต่ละเลข
        st.markdown("**ผลย้อนหลัง 20 งวดล่าสุด:**")
        for num in st.session_state.ticket_nums:
            sub_hist = df[df[col_name].astype(str).replace("nan","") == num].sort_values("date", ascending=False).head(20)
            if not sub_hist.empty:
                dates_str = "  ·  ".join(sub_hist["date"].dt.strftime("%d/%m/%y").tolist())
                st.markdown(
                    f'<div class="mini-card"><b style="color:#f5e642">{num}</b>'
                    f'&nbsp;&nbsp;<span style="color:#888;font-size:.85rem">{dates_str}</span></div>',
                    unsafe_allow_html=True
                )
            else:
                st.markdown(
                    f'<div class="mini-card"><b style="color:#ff6b35">{num}</b>'
                    f'&nbsp;&nbsp;<span style="color:#888">ไม่เคยออกในช่วงที่เลือก</span></div>',
                    unsafe_allow_html=True
                )

        # radar เปรียบ metrics ของเลขในกลุ่ม
        if len(st.session_state.ticket_nums) >= 2:
            fig_tk = go.Figure()
            cats_tk = ["ออกทั้งหมด", "อัตรา (%)", "ค้างกี่งวด"]
            for _, row in tk_df.iterrows():
                vals = [row["ออกทั้งหมด"], row["อัตรา (%)"], row["ค้างกี่งวด"]]
                max_v = max(vals) if max(vals) > 0 else 1
                fig_tk.add_trace(go.Scatterpolar(
                    r=[v / max_v for v in vals] + [vals[0] / max_v],
                    theta=cats_tk + [cats_tk[0]],
                    name=row["เลข"], mode="lines+markers",
                ))
            fig_tk.update_layout(
                polar=dict(radialaxis=dict(visible=True, range=[0, 1], gridcolor="#333"),
                           bgcolor="#1a1a2e"),
                paper_bgcolor="#0e1117", font=dict(color="#fafafa"),
                showlegend=True, height=380, title="เปรียบ metrics ทุกเลขในตั๋ว",
            )
            st.plotly_chart(fig_tk, use_container_width=True)
    else:
        st.info("เพิ่มเลขด้านบนเพื่อเริ่มวิเคราะห์")


# ─── Tab 13: ML Prediction ────────────────────────────────────────────────────
with tab13:
    st.subheader("🤖 Machine Learning Prediction")
    st.caption(
        "GradientBoosting model ที่ train จากข้อมูลประวัติ — "
        "features: month, weekday, overdue, อัตราความถี่หลายมิติ, momentum, lag-1"
    )

    digits_ml = 2 if col_name in ("top2", "bottom2") else (6 if col_name == "prize1" else 3)
    if digits_ml >= 6:
        st.warning("ML ไม่รองรับ รางวัลที่ 1 (10^6 ตัวเลข)")
    else:
        ml_upcoming = next_thai_draw(datetime.now())
        ml_draw_options = {
            f"{d['day']} {MONTH_TH.get(d['month'], '')} {d['year']+543}": d["date"]
            for d in ml_upcoming
        }
        ml_draw_label = st.selectbox("เลือกงวด", list(ml_draw_options.keys()), key="ml_draw")
        ml_draw_date = ml_draw_options[ml_draw_label]

        ml_col1, ml_col2 = st.columns([1, 1])
        with ml_col1:
            already_trained = model_exists(col_name)
            _train_label = "🔄 Re-train model" if already_trained else "🚀 Train ML model"
            if st.button(_train_label, use_container_width=True):
                with st.spinner("กำลัง train model... (ใช้เวลา 10-60 วินาที)"):
                    train_model(df_raw, col_name, force=True)
                st.success("Train เสร็จแล้ว!")
                st.rerun()
        with ml_col2:
            if already_trained:
                st.success(f"✅ Model พร้อม ({col_name})")
            else:
                st.info("กด Train ก่อนเพื่อใช้ ML prediction")

        if already_trained:
            try:
                with st.spinner("กำลัง predict..."):
                    ml_pred = predict_ml(df_raw, col_name, ml_draw_date, top_n=top_n)
            except Exception as _ml_err:
                st.error(f"ML prediction error: {_ml_err}")
                ml_pred = pd.DataFrame()

            if not ml_pred.empty:
                # Badge display
                badge_html = "".join(
                    f'<span class="num-badge">{row["เลข"]}</span>'
                    for _, row in ml_pred.head(5).iterrows()
                )
                st.markdown(
                    f'<div style="text-align:center;margin:12px 0">'
                    f'<div style="color:#aaa;font-size:.85rem;margin-bottom:8px">🤖 ML Top 5</div>'
                    f'{badge_html}</div>',
                    unsafe_allow_html=True
                )

                ml_l, ml_r = st.columns([3, 2])
                with ml_l:
                    st.dataframe(
                        ml_pred,
                        use_container_width=True,
                        column_config={
                            "ML Score": st.column_config.ProgressColumn(
                                "ML Score", min_value=0,
                                max_value=float(ml_pred["ML Score"].max()) if not ml_pred.empty else 1
                            ),
                        }
                    )
                with ml_r:
                    # Compare ML vs statistical prediction
                    stat_pred = predict_with_reasons(df_raw, col_name, ml_draw_date, top_n=top_n)
                    ml_nums = set(ml_pred["เลข"].tolist())
                    stat_nums = set(stat_pred["เลข"].tolist())
                    common = ml_nums & stat_nums

                    st.markdown("#### ความเห็นตรงกัน (ML + สถิติ)")
                    if common:
                        common_html = "".join(
                            f'<span class="num-badge" style="border-color:#54a24b;color:#54a24b">{n}</span>'
                            for n in sorted(common)
                        )
                        st.markdown(common_html, unsafe_allow_html=True)
                        st.caption(f"ทั้ง 2 วิธีเห็นตรงกัน {len(common)} เลข — เลขกลุ่มนี้น่าเชื่อถือที่สุด")
                    else:
                        st.info("ไม่มีเลขที่ตรงกัน")

                # Feature importance
                fi_df = get_feature_importance(col_name)
                if not fi_df.empty:
                    st.subheader("Feature Importance — ตัวแปรที่ Model ใช้มากที่สุด")
                    fig_fi = px.bar(
                        fi_df, x="Importance", y="Feature",
                        orientation="h", color="Importance",
                        color_continuous_scale="YlOrRd",
                    )
                    fig_fi.update_layout(
                        paper_bgcolor=_PLOT_PAPER, plot_bgcolor=_PLOT_BG,
                        font=dict(color="#fafafa"), height=320,
                        yaxis=dict(categoryorder="total ascending"),
                        showlegend=False,
                    )
                    st.plotly_chart(fig_fi, use_container_width=True)


# ─── Tab 14: เครือข่ายเลข (Network Graph) ───────────────────────────────────
with tab14:
    st.subheader("🌐 เครือข่ายเลข — Number Correlation Network")
    st.caption("เส้นเชื่อมระหว่าง 2 ประเภท คือ เลขที่มักออกในงวดเดียวกัน")

    net_col1, net_col2 = st.columns(2)
    with net_col1:
        net_type_a = st.selectbox("ประเภท A (node สี)", list(LOTTERY_TYPES.keys()),
                                   index=2, key="net_a")
        net_col_a = LOTTERY_TYPES[net_type_a]
    with net_col2:
        net_type_b = st.selectbox("ประเภท B (node สีอื่น)", list(LOTTERY_TYPES.keys()),
                                   index=6, key="net_b")
        net_col_b = LOTTERY_TYPES[net_type_b]

    min_cooccur = st.slider("เส้นต้องออกร่วมกันอย่างน้อย (ครั้ง)", 2, 20, 4, key="min_cooccur")

    if net_col_a == net_col_b:
        st.warning("เลือก 2 ประเภทที่ต่างกัน")
    else:
        try:
          with st.spinner("สร้าง network..."):
            nodes_df, edges_df = number_network_data(df, net_col_a, net_col_b, min_weight=min_cooccur)
        except Exception as _net_err:
          st.error(f"Network error: {_net_err}")
          edges_df = pd.DataFrame()
          nodes_df = pd.DataFrame()

        if edges_df.empty:
            st.warning("ไม่มีเส้นเชื่อมที่ตรงกับเงื่อนไข ลด min_cooccur ลง")
        else:
            # Spring layout using networkx
            import networkx as nx
            G = nx.Graph()
            for _, e in edges_df.iterrows():
                G.add_edge(e["a"], e["b"], weight=e["weight"])

            pos = nx.spring_layout(G, seed=42, k=2.5)

            # Build plotly figure
            edge_x, edge_y, edge_hover = [], [], []
            for e in G.edges(data=True):
                x0, y0 = pos[e[0]]
                x1, y1 = pos[e[1]]
                edge_x += [x0, x1, None]
                edge_y += [y0, y1, None]
                edge_hover.append(f"{e[0]}↔{e[1]}: {e[2]['weight']} ครั้ง")

            fig_net = go.Figure()

            # Draw edges
            fig_net.add_trace(go.Scatter(
                x=edge_x, y=edge_y, mode="lines",
                line=dict(width=0.8, color="rgba(245,230,66,0.2)"),
                hoverinfo="none", showlegend=False,
            ))

            # Nodes type A
            nodes_a = [n for n in G.nodes() if n in df[net_col_a].astype(str).values]
            nodes_b = [n for n in G.nodes() if n not in nodes_a]
            freq_a = df[net_col_a].value_counts()
            freq_b = df[net_col_b].value_counts()

            for nodes_grp, freq_map, color, name in [
                (nodes_a, freq_a, "#f5e642", net_type_a),
                (nodes_b, freq_b, "#4cc9f0", net_type_b),
            ]:
                if not nodes_grp:
                    continue
                xs = [pos[n][0] for n in nodes_grp]
                ys = [pos[n][1] for n in nodes_grp]
                sizes = [max(8, min(30, freq_map.get(n, 1) * 1.5)) for n in nodes_grp]
                texts = [f"{n}<br>ออก {freq_map.get(n, 0)} ครั้ง" for n in nodes_grp]
                fig_net.add_trace(go.Scatter(
                    x=xs, y=ys, mode="markers+text",
                    marker=dict(size=sizes, color=color,
                                line=dict(width=1, color="#333")),
                    text=nodes_grp, textposition="top center",
                    textfont=dict(size=9, color=color),
                    hovertext=texts, hoverinfo="text",
                    name=name,
                ))

            fig_net.update_layout(
                paper_bgcolor=_PLOT_PAPER, plot_bgcolor=_PLOT_BG,
                font=dict(color="#fafafa"),
                height=600,
                showlegend=True,
                xaxis=dict(showgrid=False, zeroline=False, showticklabels=False),
                yaxis=dict(showgrid=False, zeroline=False, showticklabels=False),
                title=f"Network: {net_type_a} ↔ {net_type_b} (min {min_cooccur} ครั้ง)",
                margin=dict(l=10, r=10, t=50, b=10),
            )
            st.plotly_chart(fig_net, use_container_width=True)

            st.caption(f"nodes: {G.number_of_nodes()} เลข | edges: {G.number_of_edges()} เส้นเชื่อม")

            # Top co-occurring pairs
            st.subheader("คู่เลขที่ออกร่วมกันบ่อยที่สุด")
            top_edges = edges_df.sort_values("weight", ascending=False).head(15)
            top_edges.columns = [net_type_a, net_type_b, "ออกร่วมกัน (ครั้ง)"]
            st.dataframe(top_edges, use_container_width=True, hide_index=True)


# ─── Footer ───────────────────────────────────────────────────────────────────
st.divider()
st.caption("ข้อมูลจาก myhora.com | สถิตินี้ใช้เพื่อวิเคราะห์เชิงข้อมูลเท่านั้น")
