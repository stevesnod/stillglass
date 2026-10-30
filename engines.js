export const ENGINES = {
  google: {
    label: "Google Lens",
    home: "https://lens.google.com/",
    upload: "paste",
    search: (url) => `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(url)}`,
  },
  tineye: {
    label: "TinEye",
    home: "https://www.tineye.com/",
    upload: "paste",
    search: (url) => `https://www.tineye.com/search?url=${encodeURIComponent(url)}`,
  },
  yandex: {
    label: "Yandex",
    home: "https://yandex.com/images/",
    upload: "yandex",
    search: (url) =>
      `https://yandex.com/images/search?rpt=imageview&url=${encodeURIComponent(url)}`,
  },
  bing: {
    label: "Bing",
    home: "https://www.bing.com/images",
    upload: "bing",
    search: (url) =>
      `https://www.bing.com/images/search?view=detailv2&iss=sbi&form=SBIIRP&sbisrc=UrlPaste&q=imgurl:${encodeURIComponent(url)}`,
  },
};

export const ENGINE_IDS = ["google", "tineye", "yandex", "bing"];

export function isPublicUrl(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}
