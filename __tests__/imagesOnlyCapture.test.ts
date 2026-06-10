import {
  _resolveCompletionPolicy,
  _decideImagesOnlyOutcome,
  DEFAULT_REQUIRED_FIELDS,
} from '../src/useLicenseScanner';
import { normalizeLicenseData } from '../src/native';
import type { LicenseDataSpec } from '../src/specs/DLScan.nitro';
import type { LicenseData } from '../src';

// Contract tests for the images-only capture mode
// (`completion.capture: 'imagesOnly'`): the scan completes as soon as
// `cardImagePath` is set (headshot attempted, legitimately nullable),
// `requiredFields` is ignored, every field value stays null, and the
// validation-pass + TTA machinery is forced off. The decision logic is pure
// (_resolveCompletionPolicy / _decideImagesOnlyOutcome) so it is testable
// without the hook or a native build.

const base = (over: Partial<LicenseData> = {}): LicenseData =>
  ({
    firstName: null,
    lastName: null,
    middleName: null,
    dateOfBirth: null,
    expirationDate: null,
    issueDate: null,
    licenseNumber: null,
    street: null,
    city: null,
    state: null,
    postalCode: null,
    country: null,
    sex: null,
    eyeColor: null,
    hairColor: null,
    height: null,
    weight: null,
    vehicleClass: null,
    restrictions: null,
    endorsements: null,
    aamvaVersion: null,
    documentType: null,
    mrz: null,
    dataConfidence: null,
    cardImagePath: null,
    ocrObservations: null,
    headshotImagePath: null,
    ...over,
  }) as LicenseData;

const CARD = 'file:///data/dlscan-cards/00000000-card.jpg';
const HEADSHOT = 'file:///data/dlscan-cards/00000000-headshot.jpg';

describe('_resolveCompletionPolicy (capture mode resolution)', () => {
  it('defaults to the full pipeline (imagesOnly off, defaults intact)', () => {
    const cfg = _resolveCompletionPolicy(undefined);
    expect(cfg.imagesOnly).toBe(false);
    expect(cfg.requiredFields).toEqual(DEFAULT_REQUIRED_FIELDS);
    expect(cfg.validationPass).toBe(true);
    expect(cfg.ttaEnabled).toBe(true);
    expect(cfg.ttaModeInts.length).toBeGreaterThan(0);
    expect(cfg.maxFrames).toBe(30);
  });

  it("treats an explicit capture: 'full' identically to the default", () => {
    expect(_resolveCompletionPolicy({ capture: 'full' })).toEqual(
      _resolveCompletionPolicy(undefined)
    );
  });

  it("capture: 'imagesOnly' forces the field machinery off", () => {
    const cfg = _resolveCompletionPolicy({ capture: 'imagesOnly' });
    expect(cfg.imagesOnly).toBe(true);
    // requiredFields is documented as IGNORED in this mode.
    expect(cfg.requiredFields).toEqual([]);
    // Native returns null until the capture frame; there is no second frame
    // for a validation pass to confirm against.
    expect(cfg.validationPass).toBe(false);
    // Nothing was OCR'd and no TTA crop is retained — TTA must not run.
    expect(cfg.ttaEnabled).toBe(false);
    expect(cfg.ttaModeInts).toEqual([]);
  });

  it('imagesOnly overrides explicitly-passed requiredFields / validationPass / tta', () => {
    const cfg = _resolveCompletionPolicy({
      capture: 'imagesOnly',
      requiredFields: ['firstName', 'lastName'],
      validationPass: true,
      tta: { enabled: true, modes: ['blueChannel'] },
    });
    expect(cfg.requiredFields).toEqual([]);
    expect(cfg.validationPass).toBe(false);
    expect(cfg.ttaEnabled).toBe(false);
    expect(cfg.ttaModeInts).toEqual([]);
  });

  it('imagesOnly keeps the configurable maxFrames defensive cap', () => {
    const cfg = _resolveCompletionPolicy({
      capture: 'imagesOnly',
      maxFrames: 12,
    });
    expect(cfg.maxFrames).toBe(12);
  });
});

describe('_decideImagesOnlyOutcome (completion semantics)', () => {
  it('completes on the first frame that carries cardImagePath — all field values null', () => {
    const d = _decideImagesOnlyOutcome(
      base({ cardImagePath: CARD, headshotImagePath: HEADSHOT }),
      1,
      30
    );
    expect(d).toEqual({ complete: true, finalize: true, phase: 'complete' });
  });

  it('a null headshot still completes (headshot is best-effort/nullable)', () => {
    const d = _decideImagesOnlyOutcome(
      base({ cardImagePath: CARD, headshotImagePath: null }),
      1,
      30
    );
    expect(d.complete).toBe(true);
    expect(d.phase).toBe('complete');
  });

  it('populated FIELDS without a card image do NOT complete (requiredFields-style presence is irrelevant)', () => {
    // Even a frame that somehow carried every default required field must not
    // finalize the images-only scan: the contract is cardImagePath, period.
    const d = _decideImagesOnlyOutcome(
      base({
        firstName: 'MARIA',
        lastName: 'GARCIA',
        street: '123 MAIN ST',
        city: 'SPRINGFIELD',
        state: 'WI',
        postalCode: '54016',
        dateOfBirth: '1985-03-12',
        licenseNumber: 'J415-2208-5573-28',
        cardImagePath: null,
      }),
      1,
      30
    );
    expect(d.complete).toBe(false);
    expect(d.finalize).toBe(false);
    expect(d.phase).toBe('scanning');
  });

  it('keeps scanning below the cap when no card image yet', () => {
    const d = _decideImagesOnlyOutcome(base(), 5, 30);
    expect(d).toEqual({ complete: false, finalize: false, phase: 'scanning' });
  });

  it("finalizes 'incomplete' at the maxFrames defensive cap without a capture", () => {
    const d = _decideImagesOnlyOutcome(base(), 30, 30);
    expect(d).toEqual({
      complete: false,
      finalize: true,
      phase: 'incomplete',
    });
  });
});

describe('images-only result shape at the JS boundary', () => {
  it('normalizes the native images-only spec to all-null fields + image paths, observations null', () => {
    // Exactly what captureFrontImages returns on success: every data field
    // absent, only the two image paths populated, no ocrObservations (the
    // pass that produces them is skipped).
    const spec: LicenseDataSpec = {
      cardImagePath: CARD,
      headshotImagePath: HEADSHOT,
    };
    const data = normalizeLicenseData(spec);
    expect(data.cardImagePath).toBe(CARD);
    expect(data.headshotImagePath).toBe(HEADSHOT);
    // Observations come from the OCR pass — absent in images-only mode.
    expect(data.ocrObservations).toBeNull();
    // Every user-facing field value is null (never undefined).
    expect(data.firstName).toBeNull();
    expect(data.lastName).toBeNull();
    expect(data.dateOfBirth).toBeNull();
    expect(data.licenseNumber).toBeNull();
    expect(data.street).toBeNull();
    expect(data.sex).toBeNull();
    expect(data.dataConfidence).toBeNull();
    expect(data.aamvaVersion).toBeNull();
  });
});
