/**
 * 木鱼挂件 · 美术资产
 * ---------------------------------------------------------------------------
 * 这里只放「图形 + 文案 + 敲击参数」的纯数据，不含任何交互逻辑。
 * content.js 通过全局 MuyuArt 读取，manifest 里排在 content.js 之前加载。
 *
 * 设计语言（宋器 · 金木）：
 *   紫檀木体 + 墨影 + 金线描边。整体偏沉、偏哑，靠高光和描金提气，
 *   这样放在白底、深色、花哨的网页上都能立住，不会像贴纸一样飘。
 *
 * 视口约定：所有被敲对象用 viewBox 0 0 120 120，视觉中心约 (60, 60)；
 *          工具用 viewBox 0 0 60 100，握把在下、敲头在上。
 */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 共用定义：渐变 / 高光 / 阴影。id 全局唯一，避免多个 SVG 互相覆盖。
   * ------------------------------------------------------------------ */
  const DEFS = `
    <defs>
      <!-- 紫檀木体：左上受光，右下入墨 -->
      <radialGradient id="mu-wood" cx="32%" cy="20%" r="92%">
        <stop offset="0%" stop-color="#f2c48c"/>
        <stop offset="22%" stop-color="#d99456"/>
        <stop offset="48%" stop-color="#b0652c"/>
        <stop offset="72%" stop-color="#7e3d13"/>
        <stop offset="90%" stop-color="#4d2008"/>
        <stop offset="100%" stop-color="#2d1003"/>
      </radialGradient>

      <!-- 木纹横带：叠在木体上，压出年轮的哑光质感 -->
      <linearGradient id="mu-grain" x1="0.1" y1="0" x2="0.9" y2="1">
        <stop offset="0%" stop-color="#ffd9a8" stop-opacity="0.30"/>
        <stop offset="34%" stop-color="#d98f4c" stop-opacity="0.06"/>
        <stop offset="66%" stop-color="#5c2a0b" stop-opacity="0.12"/>
        <stop offset="100%" stop-color="#2a0e02" stop-opacity="0.34"/>
      </linearGradient>

      <!-- 描金：上缘亮，下缘沉 -->
      <linearGradient id="mu-gold" x1="0.15" y1="0" x2="0.75" y2="1">
        <stop offset="0%" stop-color="#ffe8bd"/>
        <stop offset="26%" stop-color="#e8b45a"/>
        <stop offset="64%" stop-color="#a9752c"/>
        <stop offset="100%" stop-color="#4a2a08"/>
      </linearGradient>

      <!-- 凹陷（鱼口、鳃裂）：越深越黑 -->
      <linearGradient id="mu-void" x1="0" y1="0" x2="0.3" y2="1">
        <stop offset="0%" stop-color="#180701" stop-opacity="0.96"/>
        <stop offset="60%" stop-color="#2c0d02" stop-opacity="0.86"/>
        <stop offset="100%" stop-color="#5c2a0b" stop-opacity="0.5"/>
      </linearGradient>

      <!-- 大块高光 -->
      <radialGradient id="mu-spec" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#fff4e0" stop-opacity="0.82"/>
        <stop offset="46%" stop-color="#ffe6c4" stop-opacity="0.22"/>
        <stop offset="100%" stop-color="#ffe6c4" stop-opacity="0"/>
      </radialGradient>

      <!-- 接地暗部 -->
      <radialGradient id="mu-occl" cx="50%" cy="42%" r="60%">
        <stop offset="0%" stop-color="#1c0801" stop-opacity="0"/>
        <stop offset="70%" stop-color="#1c0801" stop-opacity="0.06"/>
        <stop offset="100%" stop-color="#1c0801" stop-opacity="0.42"/>
      </radialGradient>

      <filter id="mu-drop" x="-45%" y="-35%" width="190%" height="200%">
        <feDropShadow dx="0" dy="4.2" stdDeviation="3.4" flood-color="#150801" flood-opacity="0.46"/>
      </filter>

      <!-- 内侧柔和内阴影，让鱼口「陷」进去 -->
      <filter id="mu-inset" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="2.6" result="b"/>
        <feOffset in="b" dx="0.6" dy="1.6" result="o"/>
        <feComposite in="SourceAlpha" in2="o" operator="out" result="ring"/>
        <feFlood flood-color="#1b0700" flood-opacity="0.62" result="c"/>
        <feComposite in="c" in2="ring" operator="in" result="shadow"/>
        <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="shadow"/></feMerge>
      </filter>
    </defs>`;

  /* ------------------------------------------------------------------ *
   * 被敲对象一：木鱼
   * 参照实物（团鱼形木鱼）的结构，三层由下往上：
   *   ① 圆鼓木身，正脸雕满扇形鳞片          —— 体量感
   *   ② 上部一道深色长缝（出音口）          —— 最关键的识别点
   *   ③ 缝上方鱼头卷起的两个瓣 + 盘绕的尾    —— 把它从「罐子」里救出来
   * 三条缺一条，104px 下就会退化成杯/笑脸/贴纸。
   * ------------------------------------------------------------------ */
  const MUYU_SVG = `
    <svg class="my-subject" viewBox="0 0 120 120" aria-hidden="true">
      ${DEFS}
      <defs>
        <!-- 鳞片填充：底暗面亮，压出雕刻的立体 -->
        <linearGradient id="mu-scale" x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0%" stop-color="#d49a58"/>
          <stop offset="40%" stop-color="#a96227"/>
          <stop offset="100%" stop-color="#5e2a0c"/>
        </linearGradient>
        <!-- 出音口内腔：越往里越黑 -->
        <radialGradient id="mu-cav" cx="50%" cy="30%" r="80%">
          <stop offset="0%" stop-color="#0d0300"/>
          <stop offset="55%" stop-color="#1a0701"/>
          <stop offset="100%" stop-color="#3c1505"/>
        </radialGradient>
      </defs>

      <g filter="url(#mu-drop)">
        <!-- ============ ① 木身 ============ -->
        <path d="M60 24c25 0 44 17 44 39 0 21-19 36-44 36S16 84 16 63c0-22 19-39 44-39Z"
              fill="url(#mu-wood)"/>

        <g clip-path="url(#mu-body-clip)">
          <rect x="0" y="0" width="120" height="120" fill="url(#mu-grain)"/>

          <!-- ============ ② 正脸鳞片：手工排布，行间错开、疏密不均 ============ -->
          <g opacity="0.95">
            <!-- 底排（大鳞） -->
            <g fill="url(#mu-scale)" stroke="#3a1705" stroke-width="0.9" opacity="0.55">
              <path d="M30 76c4.2-4.2 9.4-4.2 13.6 0-1 6.2-3.1 10.4-6.8 13.6C33.1 86.4 31 82.2 30 76Z"/>
              <path d="M45 80c4.2-4.2 9.4-4.2 13.6 0-1 6.2-3.1 10.4-6.8 13.6C48.1 90.4 46 86.2 45 80Z"/>
              <path d="M60 81c4.2-4.2 9.4-4.2 13.6 0-1 6.2-3.1 10.4-6.8 13.6C63.1 91.4 61 87.2 60 81Z"/>
              <path d="M74 79c4.2-4.2 9.4-4.2 13.6 0-1 6.2-3.1 10.4-6.8 13.6C77.1 89.4 75 85.2 74 79Z"/>
              <path d="M86 73c4-4 8.8-4 12.8 0-.9 5.9-2.9 9.9-6.4 12.9C89 83 87 79 86 73Z"/>
            </g>
            <!-- 中排（错开半格） -->
            <g fill="url(#mu-scale)" stroke="#3a1705" stroke-width="0.85" opacity="0.5">
              <path d="M37 64c3.6-3.4 8-3.4 11.6 0-.9 5.4-2.7 9-5.8 11.7C39.7 73 38 69.4 37 64Z"/>
              <path d="M51 67c3.6-3.4 8-3.4 11.6 0-.9 5.4-2.7 9-5.8 11.7C53.7 76 52 72.4 51 67Z"/>
              <path d="M65 67c3.6-3.4 8-3.4 11.6 0-.9 5.4-2.7 9-5.8 11.7C67.7 76 66 72.4 65 67Z"/>
              <path d="M78 64c3.6-3.4 8-3.4 11.6 0-.9 5.4-2.7 9-5.8 11.7C80.7 73 79 69.4 78 64Z"/>
            </g>
            <!-- 上排（小鳞，紧贴缝口） -->
            <g fill="url(#mu-scale)" stroke="#3a1705" stroke-width="0.8" opacity="0.42">
              <path d="M43 55c3-2.8 6.6-2.8 9.6 0-.8 4.4-2.3 7.4-4.8 9.6C45.2 62.4 43.8 59.4 43 55Z"/>
              <path d="M55 57c3-2.8 6.6-2.8 9.6 0-.8 4.4-2.3 7.4-4.8 9.6C57.2 64.4 55.8 61.4 55 57Z"/>
              <path d="M67 57c3-2.8 6.6-2.8 9.6 0-.8 4.4-2.3 7.4-4.8 9.6C69.2 64.4 67.8 61.4 67 57Z"/>
            </g>
            <!-- 鳞片的下缘高光：让每片都翘起来 -->
            <g fill="none" stroke="#ffd7a2" stroke-width="0.9" opacity="0.28" stroke-linecap="round">
              <path d="M31.5 76.5c3.6-3.6 8-3.6 11.6 0"/>
              <path d="M46.5 80.5c3.6-3.6 8-3.6 11.6 0"/>
              <path d="M61.5 81.5c3.6-3.6 8-3.6 11.6 0"/>
              <path d="M75.5 79.5c3.6-3.6 8-3.6 11.6 0"/>
              <path d="M87.5 73.5c3.4-3.4 7.4-3.4 10.8 0"/>
              <path d="M38.5 64.5c3-2.8 6.8-2.8 9.8 0"/>
              <path d="M52.5 67.5c3-2.8 6.8-2.8 9.8 0"/>
              <path d="M66.5 67.5c3-2.8 6.8-2.8 9.8 0"/>
              <path d="M79.5 64.5c3-2.8 6.8-2.8 9.8 0"/>
            </g>
          </g>

          <rect x="0" y="0" width="120" height="120" fill="url(#mu-occl)"/>
        </g>

        <!-- ============ ③ 出音缝：一道横贯上部的深色长缝 ============ -->
        <g>
          <!-- 缝口内腔 -->
          <path d="M39 47c7-3.6 14-5.2 21-5.2S73 43.4 80 47c-6 3.4-13 5-20 5s-14-1.6-21-5Z"
                fill="url(#mu-cav)"/>
          <path d="M43 47.4c5.6-2.6 11-3.8 17-3.8s11.4 1.2 17 3.8c-5 2.2-10.6 3.2-17 3.2s-12-1-17-3.2Z"
                fill="#070100"/>
          <!-- 缝口上下唇：上唇厚而暗，下唇薄而受光 -->
          <path d="M38 46.4c7-3.8 14.4-5.6 22-5.6s15 1.8 22 5.6" fill="none"
                stroke="#180701" stroke-width="2.4" stroke-linecap="round" opacity="0.85"/>
          <path d="M38 47.6c7 3.8 14.4 5.6 22 5.6s15-1.8 22-5.6" fill="none"
                stroke="#c98a48" stroke-width="1.5" stroke-linecap="round" opacity="0.6"/>
          <path d="M40 48c6.6 3.4 13 5 20 5s13.4-1.6 20-5" fill="none"
                stroke="#ffe4bc" stroke-width="0.9" stroke-linecap="round" opacity="0.3"/>
        </g>

        <!-- ============ ④ 缝上方的鱼头双瓣：低矮圆钝，像鱼头两侧隆起 ============ -->
        <g>
          <!-- 左瓣 -->
          <path d="M35 46c-4.6-5.4-3.4-13 2.6-16.4 5.4-3 11.6-1 13.4 4.4 1 3.4.2 7-2.2 9.8-1.8-3.4-5-5.6-9-6.2-1.8-.3-3.4-.2-4.8.4Z"
                fill="url(#mu-wood)"/>
          <path d="M35 46c-4.6-5.4-3.4-13 2.6-16.4 5.4-3 11.6-1 13.4 4.4 1 3.4.2 7-2.2 9.8-1.8-3.4-5-5.6-9-6.2-1.8-.3-3.4-.2-4.8.4Z"
                fill="none" stroke="url(#mu-gold)" stroke-width="1.2" opacity="0.62"/>
          <path d="M42.5 33c3.4 1.4 5.6 3.8 6.4 7" fill="none" stroke="#2a0e02"
                stroke-width="1.1" stroke-linecap="round" opacity="0.32"/>
          <!-- 右瓣（略大，是盘回来的鱼尾） -->
          <path d="M85 46c4.6-5.4 3.4-13-2.6-16.4-5.4-3-11.6-1-13.4 4.4-1 3.4-.2 7 2.2 9.8 1.8-3.4 5-5.6 9-6.2 1.8-.3 3.4-.2 4.8.4Z"
                fill="url(#mu-wood)"/>
          <path d="M85 46c4.6-5.4 3.4-13-2.6-16.4-5.4-3-11.6-1-13.4 4.4-1 3.4-.2 7 2.2 9.8 1.8-3.4 5-5.6 9-6.2 1.8-.3 3.4-.2 4.8.4Z"
                fill="none" stroke="url(#mu-gold)" stroke-width="1.2" opacity="0.62"/>
          <path d="M77.5 33c-3.4 1.4-5.6 3.8-6.4 7" fill="none" stroke="#2a0e02"
                stroke-width="1.1" stroke-linecap="round" opacity="0.32"/>
          <!-- 两瓣之间：浅凹，不画成尖槽 -->
          <path d="M56.4 34.6c2.4-1.8 4.8-1.8 7.2 0-1.2 3.2-2 6.4-2.4 9.8-.4-3.4-1.6-6.6-4.8-9.8Z"
                fill="#2a0e02" opacity="0.26"/>
        </g>

        <!-- ============ 描金外缘 ============ -->
        <path d="M60 24c25 0 44 17 44 39 0 21-19 36-44 36S16 84 16 63c0-22 19-39 44-39Z"
              fill="none" stroke="url(#mu-gold)" stroke-width="2.2"/>
        <path d="M60 24c25 0 44 17 44 39 0 21-19 36-44 36S16 84 16 63c0-22 19-39 44-39Z"
              fill="none" stroke="#2a0e02" stroke-width="0.7" opacity="0.42"/>

        <!-- 受光：左上主高光 + 右下反射 -->
        <ellipse cx="40" cy="33" rx="16" ry="6" fill="url(#mu-spec)" transform="rotate(-26 40 33)"/>
        <ellipse cx="86" cy="76" rx="9" ry="13" fill="url(#mu-spec)" opacity="0.3" transform="rotate(-18 86 76)"/>
      </g>
      <clipPath id="mu-body-clip">
        <path d="M60 24c25 0 44 17 44 39 0 21-19 36-44 36S16 84 16 63c0-22 19-39 44-39Z"/>
      </clipPath>
    </svg>`;

  /* ------------------------------------------------------------------ *
   * 被敲对象二：锦鲤
   * 侧面游姿，尾鳍张开，靠朱红斑纹与描边立住形体。
   * ------------------------------------------------------------------ */
  const KOI_SVG = `
    <svg class="my-subject" viewBox="0 0 120 120" aria-hidden="true">
      ${DEFS}
      <defs>
        <linearGradient id="koi-body" x1="0.1" y1="0.1" x2="0.85" y2="0.95">
          <stop offset="0%" stop-color="#fff2dc"/>
          <stop offset="38%" stop-color="#f6d9b0"/>
          <stop offset="78%" stop-color="#d9a468"/>
          <stop offset="100%" stop-color="#a9743a"/>
        </linearGradient>
        <linearGradient id="koi-red" x1="0" y1="0" x2="0.8" y2="1">
          <stop offset="0%" stop-color="#f07a3c"/>
          <stop offset="55%" stop-color="#d94a1c"/>
          <stop offset="100%" stop-color="#8f2609"/>
        </linearGradient>
      </defs>
      <g filter="url(#mu-drop)">
        <!-- 尾鳍 -->
        <path d="M88 60c9-11 17-17 26-16 1 8-2 14-8 18 6 4 9 10 8 18-9 1-17-5-26-16Z"
              fill="url(#koi-red)" opacity="0.92"/>
        <!-- 背鳍 / 腹鳍 -->
        <path d="M58 36c6-8 15-12 23-10-5 5-9 11-11 17Z" fill="url(#koi-red)" opacity="0.8"/>
        <path d="M56 84c6 8 15 12 23 10-5-5-9-11-11-17Z" fill="url(#koi-red)" opacity="0.8"/>
        <!-- 主体 -->
        <ellipse cx="55" cy="60" rx="34" ry="25" transform="rotate(-7 55 60)" fill="url(#koi-body)"/>
        <!-- 朱红斑块 -->
        <g clip-path="url(#koi-clip)" opacity="0.94">
          <ellipse cx="52" cy="48" rx="17" ry="10" transform="rotate(-16 52 48)" fill="url(#koi-red)"/>
          <ellipse cx="72" cy="70" rx="12" ry="8" transform="rotate(14 72 70)" fill="url(#koi-red)"/>
          <ellipse cx="34" cy="68" rx="9" ry="6" transform="rotate(-8 34 68)" fill="url(#koi-red)"/>
        </g>
        <!-- 鳞 -->
        <g fill="none" stroke="#8a3b0c" stroke-width="1.2" opacity="0.2" stroke-linecap="round" clip-path="url(#koi-clip)">
          <path d="M36 50c7-2 15-2 22 1"/>
          <path d="M33 60c8-2 17-2 25 1"/>
          <path d="M36 70c7-2 15-2 22 1"/>
          <path d="M46 44c1 5 1 9-1 13"/>
          <path d="M60 44c1 5 1 9-1 13"/>
          <path d="M46 64c1 5 1 9-1 13"/>
          <path d="M60 64c1 5 1 9-1 13"/>
        </g>
        <!-- 眼与口 -->
        <circle cx="33" cy="53" r="6" fill="#fffaf0"/>
        <circle cx="33.4" cy="53.4" r="3.1" fill="#2a1206"/>
        <circle cx="31.6" cy="51.6" r="1.05" fill="#fff"/>
        <path d="M20 63c3 2 6 2 9 0" fill="none" stroke="#7c3408" stroke-width="2.2" stroke-linecap="round" opacity="0.75"/>
        <!-- 描边 + 高光 -->
        <ellipse cx="55" cy="60" rx="34" ry="25" transform="rotate(-7 55 60)" fill="none"
                 stroke="url(#mu-gold)" stroke-width="1.5" opacity="0.55"/>
        <ellipse cx="45" cy="45" rx="18" ry="7.5" fill="url(#mu-spec)" transform="rotate(-18 45 45)"/>
      </g>
      <clipPath id="koi-clip">
        <ellipse cx="55" cy="60" rx="34" ry="25" transform="rotate(-7 55 60)"/>
      </clipPath>
    </svg>`;

  /* ------------------------------------------------------------------ *
   * 敲击工具一：木槌
   * 实物棰头是「橄榄形」：两头收、腰最粗。手柄从腰部穿出，头重柄轻。
   * ------------------------------------------------------------------ */
  const MALLET_SVG = `
    <svg class="my-tool" viewBox="0 0 60 100" aria-hidden="true">
      <defs>
        <radialGradient id="mal-head" cx="30%" cy="26%" r="86%">
          <stop offset="0%" stop-color="#f8d8a6"/>
          <stop offset="30%" stop-color="#d09351"/>
          <stop offset="68%" stop-color="#9a5824"/>
          <stop offset="100%" stop-color="#4e220a"/>
        </radialGradient>
        <linearGradient id="mal-shaft" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#7d481b"/>
          <stop offset="30%" stop-color="#d79c5c"/>
          <stop offset="62%" stop-color="#b2763a"/>
          <stop offset="100%" stop-color="#6b3a14"/>
        </linearGradient>
      </defs>
      <!-- 手柄：上粗下细，从槌头腰部穿出 -->
      <path d="M26.4 24h7.2l-.8 68a3 3 0 0 1-5.6 0Z" fill="url(#mal-shaft)"/>
      <path d="M26.4 24h2.4l-.6 68a3 3 0 0 1-1.8-2.8Z" fill="#ffe0b4" opacity="0.38"/>
      <path d="M26.4 24h7.2l-.8 68a3 3 0 0 1-5.6 0Z" fill="none" stroke="#3a1705" stroke-width="0.8" opacity="0.42"/>
      <!-- 槌头：对称橄榄形，mid 在 y=16，腰最粗 -->
      <path d="M30 1c5.6 0 9.4 4.6 9.4 12.2 0 4-.9 7.4-2.4 10.2-1.6 3-2.4 7.6-2.4 7.6h-9.2s-.8-4.6-2.4-7.6c-1.5-2.8-2.4-6.2-2.4-10.2C20.6 5.6 24.4 1 30 1Z"
            fill="url(#mal-head)"/>
      <path d="M30 1c5.6 0 9.4 4.6 9.4 12.2 0 4-.9 7.4-2.4 10.2-1.6 3-2.4 7.6-2.4 7.6h-9.2s-.8-4.6-2.4-7.6c-1.5-2.8-2.4-6.2-2.4-10.2C20.6 5.6 24.4 1 30 1Z"
            fill="none" stroke="url(#mu-gold)" stroke-width="1.3" opacity="0.6"/>
      <ellipse cx="25.8" cy="9.6" rx="4.2" ry="2.8" fill="#fff6e6" opacity="0.5" transform="rotate(-26 25.8 9.6)"/>
      <path d="M21.6 27.6c5.4 1.4 11.4 1.4 16.8 0" fill="none" stroke="#3a1705" stroke-width="1" opacity="0.2"/>
    </svg>`;

  /* ------------------------------------------------------------------ *
   * 敲击工具二：手（掌心朝下，指尖朝敲击方向）
   * ------------------------------------------------------------------ */
  const HAND_SVG = `
    <svg class="my-tool" viewBox="0 0 60 100" aria-hidden="true">
      <defs>
        <linearGradient id="hand-skin" x1="0.15" y1="0" x2="0.9" y2="1">
          <stop offset="0%" stop-color="#ffe3c6"/>
          <stop offset="42%" stop-color="#f2bd92"/>
          <stop offset="100%" stop-color="#c07f52"/>
        </linearGradient>
      </defs>
      <rect x="25" y="52" width="14" height="46" rx="7" fill="url(#hand-skin)"/>
      <rect x="25" y="52" width="14" height="46" rx="7" fill="none" stroke="#8a5330" stroke-width="0.9" opacity="0.35"/>
      <path d="M20 60c-2-9-1-20 4-27 2-4 7-4 9 0 1 2 2 5 2 8 0-8 2-14 7-14 5 0 7 6 7 14 0 2 0 4-1 6 3-3 7-2 7 2 0 5-2 10-5 14-4 5-10 8-16 8s-11-4-14-11Z"
            fill="url(#hand-skin)"/>
      <path d="M20 60c-2-9-1-20 4-27 2-4 7-4 9 0 1 2 2 5 2 8 0-8 2-14 7-14 5 0 7 6 7 14 0 2 0 4-1 6 3-3 7-2 7 2 0 5-2 10-5 14-4 5-10 8-16 8s-11-4-14-11Z"
            fill="none" stroke="#8a5330" stroke-width="0.9" opacity="0.35"/>
      <g stroke="#a9673a" stroke-width="1.2" opacity="0.42" fill="none" stroke-linecap="round">
        <path d="M31 45c-1 6-1 12 0 17"/>
        <path d="M38 41c-1 7-1 14 0 20"/>
        <path d="M44 43c0 6 0 12-1 17"/>
      </g>
      <ellipse cx="30" cy="51" rx="6" ry="3.2" fill="#fff2e2" opacity="0.45"/>
    </svg>`;

  /* ------------------------------------------------------------------ *
   * 收起后的小图标：木鱼剪影
   * ------------------------------------------------------------------ */
  /* ------------------------------------------------------------------ *
   * 收起后的小图标：木鱼本体（缩到 46px 也能认出主体与缝口）
   * ------------------------------------------------------------------ */
  const MINI_FISH = `
    <svg class="my-tab-fish" viewBox="0 0 40 40" aria-hidden="true">
      <defs>
        <radialGradient id="mn-wood" cx="32%" cy="22%" r="92%">
          <stop offset="0%" stop-color="#f2c48c"/>
          <stop offset="26%" stop-color="#d99456"/>
          <stop offset="58%" stop-color="#a55c26"/>
          <stop offset="84%" stop-color="#6d300f"/>
          <stop offset="100%" stop-color="#3a1505"/>
        </radialGradient>
        <linearGradient id="mn-gold" x1="0.15" y1="0" x2="0.75" y2="1">
          <stop offset="0%" stop-color="#ffe8bd"/>
          <stop offset="40%" stop-color="#d8a04d"/>
          <stop offset="100%" stop-color="#7a4d16"/>
        </linearGradient>
      </defs>
      <!-- 鱼头双瓣 -->
      <path d="M11.6 14.6c-1.6-2.6-.6-5.4 2.2-6.4 2.4-.9 4.6.4 5 2.8-1.6-.6-3.2-.4-4.6.6-.9.7-1.9 1.7-2.6 3Z"
            fill="url(#mn-wood)"/>
      <path d="M28.4 14.6c1.6-2.6.6-5.4-2.2-6.4-2.4-.9-4.6.4-5 2.8 1.6-.6 3.2-.4 4.6.6.9.7 1.9 1.7 2.6 3Z"
            fill="url(#mn-wood)"/>
      <!-- 木身 -->
      <path d="M20 8c8.3 0 14 5.4 14 12.4 0 6.7-6 11.6-14 11.6S6 27.1 6 20.4C6 13.4 11.7 8 20 8Z"
            fill="url(#mn-wood)"/>
      <!-- 出音缝 -->
      <path d="M12.4 15.4c4.8-1.8 10.4-1.8 15.2 0-4.2 2-11 2-15.2 0Z" fill="#150600"/>
      <path d="M12.4 15.4c4.8-1.8 10.4-1.8 15.2 0" fill="none" stroke="#150600"
            stroke-width="1.1" stroke-linecap="round" opacity="0.9"/>
      <!-- 鳞（三层小弧，只保留轮廓） -->
      <g fill="none" stroke="#5e2a0c" stroke-width="0.8" opacity="0.5" stroke-linecap="round">
        <path d="M11 21c2.4-2.2 5.2-2.2 7.6 0"/><path d="M19 21c2.4-2.2 5.2-2.2 7.6 0"/>
        <path d="M15 25.4c2.4-2.2 5.2-2.2 7.6 0"/><path d="M22.6 25.4c2.4-2.2 5.2-2.2 7.6 0"/>
        <path d="M12.6 18.4c2-1.8 4.4-1.8 6.4 0"/><path d="M19.8 18.4c2-1.8 4.4-1.8 6.4 0"/>
      </g>
      <!-- 描金边 -->
      <path d="M20 8c8.3 0 14 5.4 14 12.4 0 6.7-6 11.6-14 11.6S6 27.1 6 20.4C6 13.4 11.7 8 20 8Z"
            fill="none" stroke="url(#mn-gold)" stroke-width="1.3"/>
      <ellipse cx="13.6" cy="12.4" rx="5" ry="2.2" fill="#fff4e0" opacity="0.4" transform="rotate(-26 13.6 12.4)"/>
    </svg>`;

  /* ------------------------------------------------------------------ *
   * 皮肤注册表
   * 每项只描述「图形 + 文案 + 敲击形变 / 挥动轨迹」，
   * 新增形象（铜钟、猫爪…）只需追加一项数据，交互逻辑不用改。
   * ------------------------------------------------------------------ */
  const SUBJECTS = {
    muyu: {
      label: '木鱼',
      verb: '功德',
      copy: {
        title: '功德',
        today: '今日功德',
        total: '累计功德',
        streak: '连续敲击',
        goal: '目标完成',
        footer: '木鱼挂件 · 敲一下，功德 +1'
      },
      svg: MUYU_SVG,
      squash: [1.06, 0.91], // 敲击瞬间的 x/y 缩放峰值
      origin: '50% 80%', // 形变原点（与木鱼重心一致）
      impact: [50, 66], // 敲击落点（占对象宽高的百分比），用于涟漪
      tone: { base: 452, ring: 1.94, thud: 0.62 } // 音色：基频 / 泛音比 / 闷度
    },
    fish: {
      label: '鱼',
      verb: '摸鱼',
      copy: {
        title: '摸鱼',
        today: '今日摸鱼',
        total: '累计摸鱼',
        streak: '连续摸鱼',
        goal: '目标完成',
        footer: '木鱼挂件 · 摸一下，摸鱼 +1'
      },
      svg: KOI_SVG,
      squash: [1.04, 0.94],
      origin: '50% 74%',
      impact: [48, 62],
      tone: { base: 520, ring: 2.3, thud: 0.34 }
    }
  };

  const TOOLS = {
    mallet: {
      label: '木槌',
      svg: MALLET_SVG,
      rest: -26,
      swing: [-26, 24, -34, -22]
    },
    hand: {
      label: '手',
      svg: HAND_SVG,
      rest: -56,
      swing: [-56, -18, -72, -58]
    }
  };

  const SKIN_DEFAULT = { subject: 'muyu', tool: 'mallet' };

  global.MuyuArt = { SUBJECTS, TOOLS, SKIN_DEFAULT, MINI_FISH };
})(typeof globalThis !== 'undefined' ? globalThis : window);
