#include "voter_c.hpp"
#include "voter.hpp"

#include <climits>
#include <cmath>
#include <cstddef>
#include <new>
#include <utility>
#include <vector>

using dlscan::FieldCandidate;
using dlscan::FieldId;
using dlscan::FieldSource;
using dlscan::FieldVoter;

namespace {

// Last consensus result owned by the voter so the returned C strings stay
// valid for the caller until the next consensus()/reset()/delete call.
// Stored next to the voter via the handle. The handle is a small struct
// rather than a raw FieldVoter pointer so we can attach the buffer.
struct CHandle {
    FieldVoter voter;
    // Last typed consensus — owns the std::string buffers backing
    // outTexts[] pointers returned by dlscan_voter_consensus until the
    // next consensus/reset/delete call.
    std::vector<FieldCandidate> lastConsensus;
    explicit CHandle(int maxVotes)
        : voter(maxVotes > 0 ? static_cast<std::size_t>(maxVotes)
                              : FieldVoter::DEFAULT_MAX_VOTES) {}
};

inline CHandle* as_handle(dlscan_voter_handle h) {
    return static_cast<CHandle*>(h);
}

constexpr float SENTINEL_FLOAT = -1.0f;
constexpr int SENTINEL_INT = INT_MIN;

inline bool is_sentinel(float f) {
    // -1.0f sentinel OR NaN (callers from JNI may use NaN by convention).
    return f == SENTINEL_FLOAT || std::isnan(f);
}

inline bool is_sentinel(int i) { return i == SENTINEL_INT; }

}  // namespace

extern "C" {

dlscan_voter_handle dlscan_voter_new(int maxVotes) {
    try {
        return new CHandle(maxVotes);
    } catch (const std::bad_alloc&) {
        return nullptr;
    }
}

void dlscan_voter_delete(dlscan_voter_handle handle) {
    delete as_handle(handle);
}

void dlscan_voter_reset(dlscan_voter_handle handle) {
    auto* h = as_handle(handle);
    if (h == nullptr) return;
    h->voter.reset();
    h->lastConsensus.clear();
}

size_t dlscan_voter_bucket_count(dlscan_voter_handle handle) {
    auto* h = as_handle(handle);
    if (h == nullptr) return 0;
    return h->voter.bucketCount();
}

void dlscan_voter_accept(
    dlscan_voter_handle handle,
    size_t count,
    const int* fieldIds,
    const int* sources,
    const char* const* texts,
    const float* ocrConf,
    const float* detectorConf,
    const float* iou,
    const int* frameIndex) {
    auto* h = as_handle(handle);
    if (h == nullptr || count == 0) return;
    if (fieldIds == nullptr || sources == nullptr || texts == nullptr) return;

    std::vector<FieldCandidate> frame;
    frame.reserve(count);
    for (size_t i = 0; i < count; ++i) {
        FieldCandidate c;
        c.id = static_cast<FieldId>(fieldIds[i]);
        c.source = static_cast<FieldSource>(sources[i]);
        if (texts[i] != nullptr) c.text = texts[i];
        if (ocrConf != nullptr && !is_sentinel(ocrConf[i]))
            c.ocrConfidence = ocrConf[i];
        if (detectorConf != nullptr && !is_sentinel(detectorConf[i]))
            c.detectorConfidence = detectorConf[i];
        if (iou != nullptr && !is_sentinel(iou[i])) c.iou = iou[i];
        if (frameIndex != nullptr && !is_sentinel(frameIndex[i]))
            c.frameIndex = frameIndex[i];
        frame.push_back(std::move(c));
    }
    h->voter.accept(frame);
}

size_t dlscan_voter_consensus(
    dlscan_voter_handle handle,
    size_t capacity,
    int* outFieldIds,
    int* outSources,
    const char** outTexts,
    float* outOcrConf,
    float* outDetectorConf,
    float* outIou,
    int* outFrameIndex) {
    auto* h = as_handle(handle);
    if (h == nullptr) return 0;
    // Stash the result inside the handle so the returned C-string pointers
    // remain valid for the caller. The next call to consensus()/reset()/
    // delete() will invalidate them — documented in voter_c.hpp.
    h->lastConsensus = h->voter.consensus();
    const size_t n = h->lastConsensus.size();
    const size_t writeCount = (n < capacity) ? n : capacity;
    for (size_t i = 0; i < writeCount; ++i) {
        const FieldCandidate& c = h->lastConsensus[i];
        if (outFieldIds != nullptr) outFieldIds[i] = static_cast<int>(c.id);
        if (outSources != nullptr) outSources[i] = static_cast<int>(c.source);
        if (outTexts != nullptr) outTexts[i] = c.text.c_str();
        if (outOcrConf != nullptr)
            outOcrConf[i] = c.ocrConfidence.value_or(SENTINEL_FLOAT);
        if (outDetectorConf != nullptr)
            outDetectorConf[i] = c.detectorConfidence.value_or(SENTINEL_FLOAT);
        if (outIou != nullptr) outIou[i] = c.iou.value_or(SENTINEL_FLOAT);
        if (outFrameIndex != nullptr)
            outFrameIndex[i] = c.frameIndex.value_or(SENTINEL_INT);
    }
    return n;
}

// v2 Sequence G — dlscan_voter_accept_legacy and
// dlscan_voter_consensus_legacy DELETED. Their lastLegacyKeys storage,
// the field_from_key / field_id_to_key_str round-trip, and the
// "_strict" suffix encoding are all gone. Use dlscan_voter_accept and
// dlscan_voter_consensus with typed FieldId / FieldSource parallel arrays.

}  // extern "C"
