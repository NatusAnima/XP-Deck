/**
 * ICONS.JS: Authentic Windows XP Vector SVG Icons
 * Replaces all Unicode emojis with crisp, resolution-independent vector graphics
 */

const XPIcons = {
  gamepad: `<svg class="xp-icon" viewBox="0 0 24 24"><path fill="#2E62CD" d="M19 6H5c-2.2 0-4 1.8-4 4v4c0 2.2 1.8 4 4 4h14c2.2 0 4-1.8 4-4v-4c0-2.2-1.8-4-4-4z"/><circle cx="6" cy="12" r="3" fill="#D4D0C8"/><path fill="#1A3B85" d="M5 11h2v2H5z"/><circle cx="16" cy="11" r="1.2" fill="#D13526"/><circle cx="18" cy="13" r="1.2" fill="#42B72A"/><circle cx="16" cy="15" r="1.2" fill="#EAB308"/><circle cx="14" cy="13" r="1.2" fill="#3B82F6"/></svg>`,
  
  floppy: `<svg class="xp-icon" viewBox="0 0 24 24"><path fill="#2B579A" d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4z"/><path fill="#D4D0C8" d="M6 3h10v6H6zM6 13h12v7H6z"/><path fill="#1A3B85" d="M13 4h2v4h-2z"/></svg>`,
  
  chart: `<svg class="xp-icon" viewBox="0 0 24 24"><path fill="#7F9DB9" d="M2 20h20v2H2z"/><path fill="#2B579A" d="M4 14h3v6H4z"/><path fill="#42B72A" d="M9 9h3v11H9z"/><path fill="#EAB308" d="M14 5h3v15h-3z"/><path fill="#D13526" d="M19 11h3v9h-3z"/></svg>`,
  
  info: `<svg class="xp-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#2080DF"/><path fill="#FFFFFF" d="M11 7h2v2h-2zm0 4h2v6h-2z"/></svg>`,
  
  keyboard: `<svg class="xp-icon" viewBox="0 0 24 24"><path fill="#ECE9D8" stroke="#716F64" stroke-width="1.5" d="M2 5h20v14H2z"/><rect x="4" y="7" width="2" height="2" fill="#333"/><rect x="7" y="7" width="2" height="2" fill="#333"/><rect x="10" y="7" width="2" height="2" fill="#333"/><rect x="13" y="7" width="2" height="2" fill="#333"/><rect x="16" y="7" width="2" height="2" fill="#333"/><rect x="19" y="7" width="2" height="2" fill="#333"/><rect x="4" y="10" width="2" height="2" fill="#333"/><rect x="7" y="10" width="2" height="2" fill="#333"/><rect x="10" y="10" width="2" height="2" fill="#333"/><rect x="13" y="10" width="2" height="2" fill="#333"/><rect x="16" y="10" width="2" height="2" fill="#333"/><rect x="19" y="10" width="2" height="2" fill="#333"/><rect x="6" y="14" width="12" height="2" fill="#333"/></svg>`,
  
  speaker: `<svg class="xp-icon" viewBox="0 0 24 24"><path fill="#333333" d="M3 9v6h4l5 5V4L7 9H3z"/><path fill="none" stroke="#2080DF" stroke-width="2" stroke-linecap="round" d="M16.5 7.5c1.5 1.5 1.5 7.5 0 9M19 4.5c3 3 3 12 0 15"/></svg>`,
  
  speakerMute: `<svg class="xp-icon" viewBox="0 0 24 24"><path fill="#666666" d="M3 9v6h4l5 5V4L7 9H3z"/><path fill="none" stroke="#D13526" stroke-width="2" stroke-linecap="round" d="M16 9l6 6m0-6l-6 6"/></svg>`,
  
  star: `<svg class="xp-icon" viewBox="0 0 24 24"><path fill="#FFB300" stroke="#CC8800" stroke-width="1.2" d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`,
  
  check: `<svg class="xp-icon" viewBox="0 0 24 24"><path fill="#2E9C19" stroke="#1E6B10" stroke-width="1.2" d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg>`,
  
  cross: `<svg class="xp-icon" viewBox="0 0 24 24"><path fill="#D13526" stroke="#991D11" stroke-width="1.2" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/></svg>`,
  
  undo: `<svg class="xp-icon" viewBox="0 0 24 24"><path fill="#2B579A" d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/></svg>`,
  
  flip: `<svg class="xp-icon" viewBox="0 0 24 24"><path fill="#333333" d="M7 16h10v1H7zm0-8h10v1H7zm-1 4h12v1H6z"/><path fill="none" stroke="#2B579A" stroke-width="2" d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"/></svg>`,
  
  gear: `<svg class="xp-icon" viewBox="0 0 24 24"><path fill="#555555" d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>`,
  
  danger: `<svg class="xp-icon" viewBox="0 0 24 24"><path fill="#FFCC00" stroke="#CC8800" stroke-width="1.2" d="M1 21h22L12 2 1 21z"/><path fill="#000000" d="M13 18h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>`,
  
  trophy: `<svg class="xp-icon" viewBox="0 0 24 24"><path fill="#FFB300" stroke="#CC8800" stroke-width="1" d="M19 5h-2V3H7v2H5c-1.1 0-2 .9-2 2v1c0 2.55 1.92 4.63 4.39 4.94.63 1.5 1.98 2.63 3.61 2.96V19H8v2h8v-2h-3v-3.1c1.63-.33 2.98-1.46 3.61-2.96C19.08 12.63 21 10.55 21 8V7c0-1.1-.9-2-2-2zM5 8V7h2v3.82C5.84 10.4 5 9.3 5 8zm14 0c0 1.3-.84 2.4-2 2.82V7h2v1z"/></svg>`,
  
  picture: `<svg class="xp-icon" viewBox="0 0 24 24"><path fill="#ECE9D8" stroke="#716F64" stroke-width="1.5" d="M3 5h18v14H3z"/><circle cx="8.5" cy="9.5" r="1.5" fill="#EAB308"/><path fill="#2B579A" d="M5 17l4.5-6 3.5 4.5 2.5-3 3.5 4.5z"/></svg>`,
  
  external: `<svg class="xp-icon" viewBox="0 0 24 24"><path fill="#2B579A" d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>`,
  
  search: `<svg class="xp-icon" viewBox="0 0 24 24"><path fill="#2B579A" d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>`,
  
  trash: `<svg class="xp-icon" viewBox="0 0 24 24"><path fill="#716F64" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`,
  
  phone: `<svg class="xp-icon" viewBox="0 0 24 24"><path fill="#333333" d="M17 1.01L7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99zM17 19H7V5h10v14z"/><circle cx="12" cy="21" r="1" fill="#2080DF"/></svg>`
};

window.XPIcons = XPIcons;
