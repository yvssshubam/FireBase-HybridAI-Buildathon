// Build-time switches. Kept in one place so the report and check-dist can name them.

/**
 * Photo upload on the dispatch and counter-evidence steps, labelled "For the demo".
 * On unless VITE_ALLOW_PHOTO_UPLOAD=false: the hackathon build needs it (judges have
 * no sealed parcel), a real launch should turn it off (an old photo could be reused).
 */
export const PHOTO_UPLOAD_ENABLED = import.meta.env.VITE_ALLOW_PHOTO_UPLOAD !== "false";
