import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Report } from "@workspace/api-client-react";
import { useListReports } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { Ionicons } from "@expo/vector-icons";

const STATUS_COLORS: Record<string, string> = {
  PENDING: "#f59e0b",
  PROCESSING: "#3b82f6",
  COMPLETED: "#22c55e",
  FAILED: "#ef4444",
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: "대기",
  PROCESSING: "처리중",
  COMPLETED: "완료",
  FAILED: "실패",
};

function ReportCard({
  report,
  colors,
}: {
  report: Report;
  colors: ReturnType<typeof useColors>;
}) {
  const statusColor = STATUS_COLORS[report.syncStatus] ?? colors.mutedForeground;
  const statusLabel = STATUS_LABELS[report.syncStatus] ?? report.syncStatus;
  const date = new Date(report.reportDate).toLocaleDateString("ko-KR", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
  });

  return (
    <Pressable
      style={({ pressed }) => [
        cardStyles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
      onPress={() => router.push(`/report/${report.id}`)}
      testID={`report-card-${report.id}`}
    >
      <View style={cardStyles.header}>
        <View style={cardStyles.meta}>
          <Text style={[cardStyles.itemCode, { color: colors.primary }]}>
            {report.itemCode}
          </Text>
          <Text style={[cardStyles.date, { color: colors.mutedForeground }]}>
            {date}
          </Text>
        </View>
        <View
          style={[
            cardStyles.badge,
            { backgroundColor: statusColor + "20", borderColor: statusColor + "40" },
          ]}
        >
          <Text style={[cardStyles.badgeText, { color: statusColor }]}>
            {statusLabel}
          </Text>
        </View>
      </View>
      <Text
        style={[cardStyles.processName, { color: colors.foreground }]}
        numberOfLines={1}
      >
        {report.processName}
      </Text>
      <Text
        style={[cardStyles.description, { color: colors.mutedForeground }]}
        numberOfLines={2}
      >
        {report.description}
      </Text>
      <View style={cardStyles.footer}>
        <Text style={[cardStyles.defectType, { color: colors.accentForeground }]}>
          {report.defectType}
        </Text>
        {report.isLocked && (
          <View style={cardStyles.lockedBadge}>
            <Ionicons name="lock-closed" size={10} color={colors.mutedForeground} />
            <Text style={[cardStyles.lockedText, { color: colors.mutedForeground }]}>
              잠김
            </Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

const cardStyles = StyleSheet.create({
  card: {
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
    gap: 6,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  itemCode: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  date: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 99,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },
  processName: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  description: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 2,
  },
  defectType: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  lockedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  lockedText: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
});

export default function HistoryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [allReports, setAllReports] = useState<Report[]>([]);
  const PAGE_SIZE = 20;

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
      setAllReports([]);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search]);

  const { data, isLoading, isError, refetch, isFetching } = useListReports({
    page,
    pageSize: PAGE_SIZE,
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
  });

  useEffect(() => {
    if (!data?.data) return;
    if (page === 1) {
      setAllReports(data.data);
    } else {
      setAllReports((prev) => {
        const existingIds = new Set(prev.map((r) => r.id));
        const newItems = data.data.filter((r) => !existingIds.has(r.id));
        return [...prev, ...newItems];
      });
    }
  }, [data, page]);

  const total = data?.total ?? 0;
  const hasMore = page * PAGE_SIZE < total;

  const s = makeStyles(colors, topPad);

  if (isLoading && page === 1 && !allReports.length) {
    return (
      <View style={[s.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (isError && !allReports.length) {
    return (
      <View style={[s.center, { backgroundColor: colors.background }]}>
        <Ionicons name="alert-circle-outline" size={48} color={colors.destructive} />
        <Text style={[s.errorText, { color: colors.foreground }]}>
          불러오기 실패
        </Text>
        <Pressable
          style={[s.retryBtn, { backgroundColor: colors.primary }]}
          onPress={() => refetch()}
        >
          <Text style={[s.retryBtnText, { color: colors.primaryForeground }]}>
            다시 시도
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[s.root, { backgroundColor: colors.background }]}>
      <View style={[s.topBar, { paddingTop: topPad + 16 }]}>
        <Text style={s.pageTitle}>제출 내역</Text>
        <Text style={s.pageSubtitle}>총 {total}건</Text>
        <View style={s.searchBar}>
          <Ionicons name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            style={s.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="품목코드, 공정, 설명 검색"
            placeholderTextColor={colors.mutedForeground}
            testID="history-search-input"
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch("")}>
              <Ionicons name="close-circle" size={16} color={colors.mutedForeground} />
            </Pressable>
          )}
        </View>
      </View>

      <FlatList
        data={allReports}
        keyExtractor={(r) => String(r.id)}
        renderItem={({ item }) => <ReportCard report={item} colors={colors} />}
        contentContainerStyle={s.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isFetching && !isLoading && page === 1}
            onRefresh={() => {
              setPage(1);
              setAllReports([]);
              refetch();
            }}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={
          !isFetching ? (
            <View style={s.emptyState}>
              <Ionicons
                name="document-text-outline"
                size={48}
                color={colors.mutedForeground}
              />
              <Text style={s.emptyTitle}>보고서 없음</Text>
              <Text style={s.emptySubtitle}>
                {debouncedSearch ? "검색 결과가 없습니다." : "아직 제출된 보고서가 없습니다."}
              </Text>
            </View>
          ) : null
        }
        onEndReached={() => {
          if (hasMore && !isFetching) setPage((p) => p + 1);
        }}
        onEndReachedThreshold={0.3}
        ListFooterComponent={
          isFetching ? (
            <ActivityIndicator
              color={colors.primary}
              style={{ paddingVertical: 16 }}
            />
          ) : null
        }
      />
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>, topPad: number) {
  return StyleSheet.create({
    root: {
      flex: 1,
    },
    topBar: {
      paddingHorizontal: 20,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.background,
    },
    pageTitle: {
      fontSize: 24,
      fontFamily: "Inter_700Bold",
      color: colors.foreground,
      marginBottom: 2,
    },
    pageSubtitle: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      marginBottom: 12,
    },
    searchBar: {
      height: 40,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 12,
      gap: 8,
    },
    searchInput: {
      flex: 1,
      fontSize: 14,
      fontFamily: "Inter_400Regular",
      color: colors.foreground,
    },
    listContent: {
      paddingHorizontal: 20,
      paddingTop: 14,
      paddingBottom: 100,
    },
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
    },
    errorText: {
      fontSize: 16,
      fontFamily: "Inter_500Medium",
    },
    retryBtn: {
      paddingHorizontal: 20,
      paddingVertical: 10,
      borderRadius: 8,
    },
    retryBtnText: {
      fontSize: 14,
      fontFamily: "Inter_600SemiBold",
    },
    emptyState: {
      alignItems: "center",
      justifyContent: "center",
      paddingTop: 80,
      gap: 10,
    },
    emptyTitle: {
      fontSize: 18,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
    },
    emptySubtitle: {
      fontSize: 14,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
    },
  });
}
