export type EposTaxRate = {
  TaxGroupId: number;
  TaxRateId: number;
  LocationId: number;
  Priority: number;
  Percentage: number;
  Name: string;
  Description?: string | null;
  TaxCode?: string | null;
};

export type EposTaxGroup = {
  Id: number;
  Name: string;
  TaxRates: EposTaxRate[];
};

export type RawEposCategory = {
  Id: number;
  ParentId: number | null;
  RootParentId: number | null;
  Name: string;
  Description?: string | null;
  ImageUrl?: string | null;
  ShowOnTill: boolean;
  Children?: RawEposCategory[];
};

export type EposNowTreatment = {
  Id: number;
  Name: string;
  Description?: string | null;
  CostPrice: number;
  IsCostPriceIncTax: boolean;
  SalePrice: number;
  IsSalePriceIncTax: boolean;
  SalePriceIncTax: number;
  EatOutPrice: number;
  IsEatOutPriceIncTax: boolean;

  // the Id of the category in Epos Now
  CategoryIdEpos: number;

  // The actual name of the category
  CategoryId: string;

  Barcode?: string | null;
  SalePriceTaxGroupId?: number | null;
  EatOutPriceTaxGroupId?: number | null;
  CostPriceTaxGroupId?: number | null;
  BrandId?: number | null;
  SupplierId?: number | null;
  PopupNoteId?: number | null;
  UnitOfSale?: string | null;
  VolumeOfSale?: number | null;
  VariantGroupId?: number | null;
  MultipleChoiceNoteId?: number | null;
  Size?: string | null;
  Sku?: string | null;
  SellOnWeb: boolean;
  SellOnTill: boolean;
  OrderCode?: string | null;
  SortPosition?: number | null;
  RrPrice?: number | null;
  ProductType?: number;
  TareWeight?: number | null;
  ArticleCode?: string | null;
  IsTaxExemptable: boolean;
  ReferenceCode?: string | null;
  IsVariablePrice: boolean;
  ExcludeFromLoyaltyPointsGain: boolean;
  IsArchived: boolean;
  ColourId?: number | null;
  MeasurementDetails?: any | null;
  Supplier?: any | null;
  SalePriceTaxGroup?: EposTaxGroup | null;
  EatOutPriceTaxGroup?: EposTaxGroup | null;
  CostPriceTaxGroup?: EposTaxGroup | null;
  ProductTags: any[];
  ProductUdfs: any[];
  AdditionalSuppliersIds: number[];
  ProductLocationAreaPrices: any[];
  ProductImages: any[];
  IsMultipleChoiceProductOptional: boolean;
  CustomerProductPricingDetails: any[];
  ContainerFeeId?: number | null;
  ButtonColourId?: number | null;
  ProductDetails?: any | null;
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

export type EposNowCategory = {
  Id: number;
  ParentId?: number | null;
  RootParentId?: number | null;
  Name: string;
  Description?: string | null;
  ImageUrl?: string | null;
  PopupNoteId?: number | null;
  IsWet: boolean;
  ShowOnTill: boolean;
  ReferenceCode?: string | null;
  PopupNote?: string | null;
};

// export type Treatment = {
//   id: number;
//   eposNowTreatmentId: number;
//   description?: string | null;
//   imageUrl?: string | null;
//   href?: string | null;
//   updated_at?: string | null;
//   created_at: string; // ISO
//   TreatmentCategoryId: number;
//   TreatmentSubCategoryId: number;
//   EposNowTreatment: Partial<EposNowTreatment>;
//   TreatmentCategory: Partial<TreatmentCategory>;
//   TreatmentSubCategory: Partial<TreatmentSubCategory>;
// };
export type TreatmentSubCategory = {
  id: number;
  name: string;
  description?: string | null;
  href?: string | null;
  imageUrl?: string | null;
  treatmentCategoryId: number;
  updated_at?: string | null;
  created_at: string; // ISO
};

export type Staff = {
  id: string;
  clerk_id: string;
  email_addresses: string[];
  image_url?: string | null;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone_number?: string | null;
  created_at: string; // ISO
  updated_at?: string | null;
};
