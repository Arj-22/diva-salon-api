export type EposNowTreatment = {
  Name: string;
  CategoryId: string;
  SalePriceExTax: number;
  SalePriceIncTax: number;
  ButtonColourId: number | null;
};
/**
 * Text content for a Google review, with optional language code.
 */
export interface GoogleReviewText {
  text: string;
  languageCode?: string;
}

/**
 * Author details attributed to a Google review.
 */
export interface GoogleAuthorAttribution {
  displayName?: string;
  uri?: string; // link to author's Google Maps profile
  photoUri?: string; // avatar URL
}

/**
 * Single Google review item (Places API).
 * Example name: "places/{placeId}/reviews/{reviewId}"
 */
export interface GooglePlaceReview {
  name: string;
  relativePublishTimeDescription?: string; // e.g., "in the last week"
  rating?: number; // 1–5
  GoogleReviewText?: GoogleReviewText; // possibly translated text
  originalText?: GoogleReviewText; // original language text
  GoogleAuthorAttribution?: GoogleAuthorAttribution;
  publishTime?: string; // ISO timestamp
  flagContentUri?: string;
  googleMapsUri?: string; // permalink to the review on Maps
}

export type TreatmentCategory = {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
  href?: string;
  updated_at?: string;
  created_at?: string;
};
