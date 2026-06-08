#pragma once

#include "license_data.hpp"

#include <cstddef>
#include <deque>
#include <map>
#include <mutex>
#include <string>
#include <utility>
#include <vector>

namespace dlscan {

/// Multi-frame field voter — accepts FieldCandidate vectors per OCR pass
/// and produces a consensus FieldCandidate vector via per-key exact-string
/// majority across a bounded vote history.
///
/// Replaces v1's two per-platform FieldVoter implementations (one in Swift,
/// one in Kotlin) with a single C++ class. The state-lifecycle objection
/// (reset on JS-side) is solved by holding the C++ Voter as a per-instance
/// member of the Nitro hybrid object — same lifetime as the v1 voters.
///
/// **Key space (round-2 lock — task #52):** the voter keys by the
/// pair `(FieldId, FieldSource)`, NOT by `FieldId` alone. This preserves
/// the v1 `list_15` vs `list_15_strict` distinction the resolver depends
/// on for the StrictAgrees → CrossValidated (1.00) tier upgrade. If we
/// collapsed both sources into one bucket, the resolver would lose the
/// signal that two independent paths agreed.
///
/// **Concurrency:** accept/consensus/reset hold an internal std::mutex.
/// Owners that hold the voter as a Swift member must wrap it in
/// std::unique_ptr<FieldVoter> because std::mutex is non-copyable and
/// Swift Cxx interop requires value-type-compatible members.
class FieldVoter {
public:
    /// Default vote history per key. 20 entries balances:
    ///   - long enough for OCR variance ("DOEFORD" vs "1 DOEFORD" vs "1DOEFORD")
    ///     to converge on the majority reading
    ///   - short enough that a moved card invalidates the previous reading
    ///     within ~10 seconds at 2 fps
    static constexpr std::size_t DEFAULT_MAX_VOTES = 20;
    static constexpr std::size_t DEFAULT_MIN_VOTES = 2;

    explicit FieldVoter(std::size_t maxVotes = DEFAULT_MAX_VOTES,
                        std::size_t minVotes = DEFAULT_MIN_VOTES);

    // Non-copyable (mutex), movable not exposed across the C++ class
    // boundary — owners hold via std::unique_ptr.
    FieldVoter(const FieldVoter&) = delete;
    FieldVoter& operator=(const FieldVoter&) = delete;

    /// Push one frame's candidates into the voter. Skips empty-text and
    /// FieldId::Unknown entries. Source-tagged: a candidate from BboxIoU
    /// and a candidate from StrictTextPool for the same FieldId vote in
    /// SEPARATE buckets — the resolver downstream sees both.
    void accept(const std::vector<FieldCandidate>& frame);

    /// Compute the cross-frame consensus. One FieldCandidate emitted per
    /// (FieldId, FieldSource) bucket only after the winning text reaches
    /// minVotes — the text with the highest vote count wins; ties are
    /// broken by recency (most recently seen wins).
    ///
    /// Each emitted candidate carries its bucket's source and the LAST
    /// observed values for ocrConfidence/detectorConfidence/iou/frameIndex
    /// (these are diagnostic, not voting inputs).
    std::vector<FieldCandidate> consensus() const;

    /// Drop all accumulated state. Called from the JS-side reset() hook.
    void reset();

    /// Diagnostic accessors — not on the critical path.
    std::size_t bucketCount() const;

private:
    struct Vote {
        std::string text;
        std::optional<float> ocrConfidence;
        std::optional<float> detectorConfidence;
        std::optional<float> iou;
        std::optional<int> frameIndex;
    };
    using Key = std::pair<FieldId, FieldSource>;

    std::size_t maxVotes_;
    std::size_t minVotes_;
    mutable std::mutex m_;
    std::map<Key, std::deque<Vote>> buckets_;
};

}  // namespace dlscan
