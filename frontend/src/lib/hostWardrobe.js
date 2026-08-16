// Lucky 777 Host Wardrobe — PURELY COSMETIC. Selecting an outfit only changes
// the host artwork shown on the Slots stage; it never touches RNG, payouts,
// ledger or any API contract. Selection is persisted client-side.
const BASE = "https://static.prod-images.emergentagent.com/jobs/2089563f-7946-482c-bbad-1a5b016d32c2/images/";

// order matches the Figma "HOST OUTFIT LANDSCAPE" 4×3 grid (11 outfits + No Host)
export const HOST_OUTFITS = [
  { id: "royal_sari", label: "Royal Sari", category: "indian", img: BASE + "423953207c5d7fbb47a51f33a4cf7c69686651cc061089731373da2fba049463.jpeg" },
  { id: "marathi_nauvari", label: "Marathi Nauvari", category: "indian", img: BASE + "0722a23a3972b55de9e29c66042d05a4b4742d5c661c242a806e731bd34d158f.jpeg" },
  { id: "gujarati_sari", label: "Gujarati Sari", category: "indian", img: BASE + "aecd80e95fcb3b6633ae012e3281f4015429b760024c1a76e7a70b4e223a091f.jpeg" },
  { id: "south_indian_silk", label: "South Indian Silk", category: "indian", img: BASE + "5884a1da404fb3096ac936c4af0f2ee38ceb467b5eca80dd6df4c4f42330f6a0.jpeg" },
  { id: "punjabi_dress", label: "Punjabi Dress", category: "indian", img: BASE + "4b1ed7bdd76f4c2a4c841708958ecd9482f0e496c3eb0348b6595f13de9a4157.jpeg" },
  { id: "bengali_sari", label: "Bengali Sari", category: "indian", img: BASE + "392107646302d56b249b8935a337cf203b310384cd97a256afed0dad026a638b.jpeg" },
  { id: "indian_lehenga", label: "Indian Lehenga", category: "indian", img: BASE + "f0c2813a77392e60c7a8bc11ec528ce9dff285caafaca053dc7b7ae1c5038da1.jpeg" },
  { id: "nagaland_dress", label: "Nagaland Dress", category: "indian", img: BASE + "fe2f6138e8ea0fb648778e1af1120c6477062e784421d4b95b347bd40e5c278e.jpeg" },
  { id: "vegas_dress", label: "Vegas Dress", category: "modern", img: BASE + "13fa3a30b87c5a43c41000d5082553f40478b38fffc6bfa4159292c04f033813.jpeg" },
  { id: "luxury_abaya", label: "Luxury Abaya", category: "modern", img: BASE + "a75f74403d52de4af4db917476fa7be6a591040d3cde418fdd3bd3a42170025b.jpeg" },
  { id: "air_hostess", label: "Air Hostess", category: "modern", img: BASE + "8ba50991df7628b3fa3e018a4fe3018e84753a2503e0fc6aa656ad36edd8faec.jpeg" },
  { id: "none", label: "No Host", category: "none", img: null },
];

export const WARDROBE_LS = "royal11_slots_host_outfit";
export const DEFAULT_OUTFIT = "royal_sari";

export const getSavedOutfit = () => {
  try { return localStorage.getItem(WARDROBE_LS) || DEFAULT_OUTFIT; } catch { return DEFAULT_OUTFIT; }
};
export const outfitById = (id) => HOST_OUTFITS.find((o) => o.id === id) || HOST_OUTFITS[0];
