/**
 * `<rolling-label>`: the drawer's "Machine sounds" switch label. It is the skin's own phrase, not a Video.js one, so
 * it carries its own words for every locale Video.js ships and follows the nearest `<media-i18n>` like the rest.
 */
import { I18nController, i18nContext, type PropertyValues, UIElement } from '@videojs/html';

const MACHINE_SOUNDS: Readonly<Record<string, string>> = {
  ar: 'أصوات الآلة',
  az: 'Maşının səsləri',
  bg: 'Звуци на машината',
  bn: 'যন্ত্রের শব্দ',
  bs: 'Zvukovi mašine',
  ca: 'Sons de la màquina',
  cs: 'Zvuky stroje',
  cy: "Synau'r peiriant",
  da: 'Maskinens lyde',
  de: 'Maschinengeräusche',
  el: 'Ήχοι μηχανισμού',
  es: 'Sonidos de la máquina',
  et: 'Masina helid',
  eu: 'Makinaren soinuak',
  fa: 'صداهای دستگاه',
  fi: 'Koneen äänet',
  fr: 'Sons de la machine',
  gd: 'Fuaimean an inneil',
  gl: 'Sons da máquina',
  he: 'צלילי המכונה',
  hi: 'मशीन की आवाज़ें',
  hr: 'Zvukovi stroja',
  hu: 'A gép hangjai',
  id: 'Suara mesin',
  it: 'Suoni della macchina',
  ja: '装置の音',
  ko: '기계 소리',
  lt: 'Mašinos garsai',
  lv: 'Mašīnas skaņas',
  mr: 'यंत्राचे आवाज',
  nb: 'Maskinlyder',
  ne: 'यन्त्रका आवाजहरू',
  nl: 'Machinegeluiden',
  nn: 'Maskinlydar',
  oc: 'Sons de la maquina',
  pl: 'Dźwięki maszyny',
  pt: 'Sons da máquina',
  ro: 'Sunetele mașinii',
  ru: 'Звуки механизма',
  sk: 'Zvuky stroja',
  sl: 'Zvoki stroja',
  sr: 'Zvukovi mašine',
  sv: 'Maskinljud',
  te: 'యంత్రపు శబ్దాలు',
  th: 'เสียงเครื่องกล',
  tr: 'Makine sesleri',
  uk: 'Звуки механізму',
  vi: 'Âm thanh của máy',
  zh: '机械音效',
  'zh-TW': '機械音效',
};

export class RollingLabelElement extends UIElement {
  readonly #i18n = new I18nController(this, i18nContext);
  #english = '';

  protected override update(changed: PropertyValues): void {
    super.update(changed);
    this.#english ||= this.textContent ?? '';
    const locale = String(this.#i18n.locale ?? 'en');
    this.textContent = MACHINE_SOUNDS[locale] ?? MACHINE_SOUNDS[locale.split('-')[0]!] ?? this.#english;
  }
}

if (!customElements.get('rolling-label')) customElements.define('rolling-label', RollingLabelElement);
