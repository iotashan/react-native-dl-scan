#include "voter.hpp"

#include <unordered_map>

namespace dlscan {

FieldVoter::FieldVoter(std::size_t maxVotes) : maxVotes_(maxVotes) {}

void FieldVoter::accept(const std::vector<FieldCandidate>& frame) {
    std::lock_guard<std::mutex> g(m_);
    for (const auto& c : frame) {
        if (c.id == FieldId::Unknown) continue;
        if (c.text.empty()) continue;
        Key k{c.id, c.source};
        auto& q = buckets_[k];
        q.push_back(Vote{c.text, c.ocrConfidence, c.detectorConfidence,
                         c.iou, c.frameIndex});
        while (q.size() > maxVotes_) {
            q.pop_front();
        }
    }
}

std::vector<FieldCandidate> FieldVoter::consensus() const {
    std::lock_guard<std::mutex> g(m_);
    std::vector<FieldCandidate> out;
    out.reserve(buckets_.size());
    for (const auto& [key, q] : buckets_) {
        if (q.empty()) continue;
        // Count text occurrences; track newest-seen index for tie-break.
        // unordered_map keyed by string is fine here — bucket sizes are
        // bounded by maxVotes_ (20).
        std::unordered_map<std::string, std::size_t> counts;
        std::unordered_map<std::string, std::size_t> lastSeen;
        for (std::size_t i = 0; i < q.size(); ++i) {
            counts[q[i].text] += 1;
            lastSeen[q[i].text] = i;
        }
        // Pick the winning text. Higher count wins; ties broken by
        // most-recent (largest lastSeen index).
        const std::string* winner = nullptr;
        std::size_t bestCount = 0;
        std::size_t bestRecency = 0;
        for (const auto& [text, count] : counts) {
            const std::size_t recency = lastSeen[text];
            if (count > bestCount ||
                (count == bestCount && recency > bestRecency)) {
                winner = &text;
                bestCount = count;
                bestRecency = recency;
            }
        }
        if (winner == nullptr) continue;
        // Emit one FieldCandidate per bucket carrying the winning text
        // and the diagnostic metadata from the MOST RECENT vote with
        // that text (not the most recent overall — the metadata should
        // describe the surviving reading, not a discarded one).
        FieldCandidate fc;
        fc.id = key.first;
        fc.source = key.second;
        fc.text = *winner;
        for (auto it = q.rbegin(); it != q.rend(); ++it) {
            if (it->text == *winner) {
                fc.ocrConfidence = it->ocrConfidence;
                fc.detectorConfidence = it->detectorConfidence;
                fc.iou = it->iou;
                fc.frameIndex = it->frameIndex;
                break;
            }
        }
        out.push_back(std::move(fc));
    }
    return out;
}

void FieldVoter::reset() {
    std::lock_guard<std::mutex> g(m_);
    buckets_.clear();
}

std::size_t FieldVoter::bucketCount() const {
    std::lock_guard<std::mutex> g(m_);
    return buckets_.size();
}

}  // namespace dlscan
