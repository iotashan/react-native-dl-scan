// Acknowledgments screen — lists every open-source dependency the example
// app ships, along with its license text.
//
// Required by MIT / BSD / Apache 2.0 / many other OSS licenses when
// redistributing binaries — they expect downstream apps to surface the
// license + copyright of upstream code somewhere the user can read.
//
// The list is generated from node_modules by scripts/generate-licenses.js
// and checked into source control as assets/licenses.json. Re-run that
// script whenever you add/remove/upgrade a dependency.

import { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import licensesData from '../assets/licenses.json';
import type { ThemeTokens, Direction } from '../theme/tokens';

interface PackageEntry {
  name: string;
  version: string;
  description: string | null;
  license: string;
  author: string | null;
  homepage: string | null;
  repository: string | null;
  licenseText: string | null;
}

interface LicensesData {
  generatedAt: string;
  count: number;
  licenseBreakdown: Record<string, number>;
  packages: PackageEntry[];
}

const data = licensesData as LicensesData;

export interface AcknowledgmentsScreenProps {
  visible: boolean;
  onClose: () => void;
  t: ThemeTokens;
  direction: Direction;
}

export function AcknowledgmentsScreen({
  visible,
  onClose,
  t,
  direction,
}: AcknowledgmentsScreenProps) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return data.packages;
    return data.packages.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.license.toLowerCase().includes(q) ||
        (p.author && p.author.toLowerCase().includes(q))
    );
  }, [query]);

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.host, { backgroundColor: t.bg }]}>
        <View style={[styles.header, { borderColor: t.hairline }]}>
          <View style={{ flex: 1 }}>
            <Text
              style={[styles.eyebrow, { fontFamily: t.mono, color: t.ink3 }]}
            >
              OPEN SOURCE LICENSES
            </Text>
            <Text
              style={[styles.title, { fontFamily: t.display, color: t.ink }]}
            >
              Acknowledgments
            </Text>
            <Text style={[styles.subtitle, { color: t.ink2 }]}>
              {data.count} package{data.count === 1 ? '' : 's'} ·{' '}
              {Object.keys(data.licenseBreakdown).length} unique license
              {Object.keys(data.licenseBreakdown).length === 1 ? '' : 's'}
            </Text>
          </View>
          <Pressable
            onPress={onClose}
            style={[
              styles.closeBtn,
              { backgroundColor: t.surface, borderColor: t.hairline },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Close acknowledgments"
          >
            <Text style={{ color: t.ink2, fontSize: 16 }}>✕</Text>
          </Pressable>
        </View>

        <View
          style={[
            styles.searchWrap,
            { backgroundColor: t.surface, borderColor: t.hairline },
          ]}
        >
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Filter by name, license, or author…"
            placeholderTextColor={t.ink3}
            style={[styles.searchInput, { color: t.ink }]}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollBody}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.breakdown}>
            <Text
              style={[
                styles.breakdownTitle,
                { fontFamily: t.mono, color: t.ink3 },
              ]}
            >
              LICENSE BREAKDOWN
            </Text>
            <View style={styles.breakdownRows}>
              {Object.entries(data.licenseBreakdown)
                .sort((a, b) => b[1] - a[1])
                .map(([license, count]) => (
                  <View
                    key={license}
                    style={[
                      styles.breakdownRow,
                      { backgroundColor: t.surface, borderColor: t.hairline },
                    ]}
                  >
                    <Text
                      style={[
                        styles.breakdownLicense,
                        { fontFamily: t.mono, color: t.ink },
                      ]}
                    >
                      {license}
                    </Text>
                    <Text
                      style={[
                        styles.breakdownCount,
                        { fontFamily: t.mono, color: t.ink2 },
                      ]}
                    >
                      {count}
                    </Text>
                  </View>
                ))}
            </View>
          </View>

          {query.trim() && (
            <Text
              style={[
                styles.resultCount,
                { fontFamily: t.mono, color: t.ink3 },
              ]}
            >
              {filtered.length} result{filtered.length === 1 ? '' : 's'}
            </Text>
          )}

          {filtered.map((pkg) => {
            const key = `${pkg.name}@${pkg.version}`;
            const isOpen = expanded.has(key);
            return (
              <View
                key={key}
                style={[
                  styles.card,
                  { backgroundColor: t.surface, borderColor: t.hairline },
                ]}
              >
                <Pressable
                  onPress={() => toggleExpand(key)}
                  accessibilityRole="button"
                  accessibilityLabel={`${isOpen ? 'Collapse' : 'Expand'} ${pkg.name}`}
                >
                  <View style={styles.cardHead}>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[styles.pkgName, { color: t.ink }]}
                        numberOfLines={2}
                      >
                        {pkg.name}
                      </Text>
                      <Text
                        style={[
                          styles.pkgVersion,
                          { fontFamily: t.mono, color: t.ink3 },
                        ]}
                      >
                        {pkg.version}
                      </Text>
                    </View>
                    <View
                      style={[styles.licensePill, { borderColor: t.hairline }]}
                    >
                      <Text
                        style={[
                          styles.licensePillText,
                          { fontFamily: t.mono, color: t.ink2 },
                        ]}
                      >
                        {pkg.license}
                      </Text>
                    </View>
                  </View>

                  {pkg.author && (
                    <Text
                      style={[styles.author, { color: t.ink2 }]}
                      numberOfLines={1}
                    >
                      {pkg.author}
                    </Text>
                  )}

                  {pkg.description && (
                    <Text
                      style={[styles.description, { color: t.ink2 }]}
                      numberOfLines={isOpen ? undefined : 2}
                    >
                      {pkg.description}
                    </Text>
                  )}

                  <Text
                    style={[
                      styles.toggleHint,
                      { fontFamily: t.mono, color: t.ink3 },
                    ]}
                  >
                    {isOpen ? 'TAP TO COLLAPSE' : 'TAP TO READ LICENSE'}
                  </Text>
                </Pressable>

                {isOpen && (
                  <View
                    style={[
                      styles.licenseBox,
                      {
                        backgroundColor:
                          direction === 'vellum' ? '#1a1611' : '#0a0a0c',
                      },
                    ]}
                  >
                    <Text
                      selectable
                      style={[
                        styles.licenseText,
                        {
                          fontFamily: t.mono,
                          color: direction === 'vellum' ? '#f6efde' : '#e4e4e7',
                        },
                      ]}
                    >
                      {pkg.licenseText ||
                        `License text not bundled. License: ${pkg.license}\nSee ${pkg.repository || pkg.homepage || 'package homepage'} for full text.`}
                    </Text>
                    {(pkg.homepage || pkg.repository) && (
                      <Text
                        style={[
                          styles.linkRow,
                          { fontFamily: t.mono, color: t.ink3 },
                        ]}
                        selectable
                      >
                        {pkg.repository || pkg.homepage}
                      </Text>
                    )}
                  </View>
                )}
              </View>
            );
          })}

          <Text style={[styles.footer, { fontFamily: t.mono, color: t.ink3 }]}>
            Generated {new Date(data.generatedAt).toISOString().slice(0, 10)} ·
            regenerate with{'\n'}node example/scripts/generate-licenses.js
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  eyebrow: {
    fontSize: 11,
    letterSpacing: 1.4,
    fontWeight: '600',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginTop: 2,
    letterSpacing: -0.4,
  },
  subtitle: {
    fontSize: 13,
    marginTop: 4,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchWrap: {
    marginHorizontal: 20,
    marginTop: 14,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
  },
  searchInput: {
    paddingVertical: 12,
    fontSize: 14,
  },
  scrollBody: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 60,
    gap: 12,
  },
  breakdown: {
    marginBottom: 8,
  },
  breakdownTitle: {
    fontSize: 11,
    letterSpacing: 1.4,
    fontWeight: '600',
    marginBottom: 8,
  },
  breakdownRows: {
    gap: 6,
  },
  breakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  breakdownLicense: {
    fontSize: 12,
  },
  breakdownCount: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  resultCount: {
    fontSize: 11,
    letterSpacing: 1.2,
    marginTop: 4,
  },
  card: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  pkgName: {
    fontSize: 15,
    fontWeight: '600',
  },
  pkgVersion: {
    fontSize: 11,
    marginTop: 2,
  },
  licensePill: {
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  licensePillText: {
    fontSize: 11,
  },
  author: {
    fontSize: 12,
    marginTop: 8,
  },
  description: {
    fontSize: 13,
    marginTop: 6,
    lineHeight: 18,
  },
  toggleHint: {
    fontSize: 10,
    letterSpacing: 1.2,
    marginTop: 10,
  },
  licenseBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: 8,
  },
  licenseText: {
    fontSize: 11,
    lineHeight: 15,
  },
  linkRow: {
    fontSize: 10,
    marginTop: 8,
  },
  footer: {
    fontSize: 10,
    textAlign: 'center',
    marginTop: 24,
    lineHeight: 14,
  },
});
