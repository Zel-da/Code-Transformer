import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  useCreateReport,
  useListFlawTypes,
  useListItems,
  useListPlants,
  useListProcesses,
  useRequestUploadUrl,
} from "@workspace/api-client-react";
import { useAuth } from "@/contexts/auth";
import { useColors } from "@/hooks/useColors";
import { Ionicons, MaterialIcons } from "@expo/vector-icons";

const ACTION_DIRECTIONS = [
  "업체 방문 수정",
  "생산팀 자체 수정",
  "업체 반출 및 수정 입고",
] as const;
type ActionDirection = (typeof ACTION_DIRECTIONS)[number];

interface FormState {
  itemCode: string;
  itemSearch: string;
  plantCd: string;
  // 2026-11 화성 공정부적합 미팅 반영: 화성(SH00)은 품번 수기 입력 생략 가능.
  // 대신 기종명·부품명 수기, 부품코드 선택. QC 가 품번 보완.
  modelName: string;
  partName: string;
  partCode: string;
  processCd: string;
  processName: string;
  flawTypeCd: string;
  defectType: string;
  actionDirection: ActionDirection | "";
  description: string;
  defectQty: string;
  imageUri: string | null;
  imageUrl: string | null;
}

const INITIAL_FORM: FormState = {
  itemCode: "",
  itemSearch: "",
  plantCd: "",
  modelName: "",
  partName: "",
  partCode: "",
  processCd: "",
  processName: "",
  flawTypeCd: "",
  defectType: "",
  actionDirection: "",
  description: "",
  defectQty: "",
  imageUri: null,
  imageUrl: null,
};

export default function SubmitScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [uploading, setUploading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [itemSearchOpen, setItemSearchOpen] = useState(false);

  // 로그인 사용자의 소속 공장(plantCd)을 자동 세팅.
  // 화성 사용자는 즉시 화성 간소화 폼이 보이게 됨.
  useEffect(() => {
    const userPlant = (user as { plantCd?: string } | null)?.plantCd;
    if (userPlant && !form.plantCd) {
      setForm((f) => ({ ...f, plantCd: userPlant }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
  const scrollRef = useRef<ScrollView>(null);

  const { data: plants } = useListPlants();
  const { data: flawTypes } = useListFlawTypes();
  const { data: processes } = useListProcesses(
    form.plantCd ? { plantCd: form.plantCd } : {}
  );
  const { data: items } = useListItems(
    form.itemSearch.length >= 2
      ? { search: form.itemSearch, limit: 10 }
      : { limit: 0 }
  );

  const createReport = useCreateReport();
  const requestUploadUrl = useRequestUploadUrl();

  const uploadImage = useCallback(
    async (uri: string): Promise<string> => {
      const name = `ncr-${Date.now()}.jpg`;
      const blob = await (await fetch(uri)).blob();
      const res = await requestUploadUrl.mutateAsync({
        data: { name, contentType: "image/jpeg", size: blob.size },
      });

      const uploadRes = await fetch(res.uploadURL, {
        method: "PUT",
        headers: { "Content-Type": "image/jpeg" },
        body: blob,
      });
      if (!uploadRes.ok) {
        throw new Error(`Image upload failed: ${uploadRes.status}`);
      }
      return res.objectPath;
    },
    [requestUploadUrl]
  );

  const pickImage = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.7,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets[0]) {
      setForm((f) => ({ ...f, imageUri: result.assets[0].uri, imageUrl: null }));
    }
  }, []);

  const takePhoto = useCallback(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("권한 필요", "카메라 사용 권한이 필요합니다.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.7,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets[0]) {
      setForm((f) => ({ ...f, imageUri: result.assets[0].uri, imageUrl: null }));
    }
  }, []);

  const isHwaseong = form.plantCd === "SH00";

  const validate = () => {
    if (!form.plantCd) return "공장을 선택하세요.";
    if (isHwaseong) {
      // 화성: 품번은 QC 가 보완. 기종명·부품명 수기 필수.
      if (!form.modelName.trim()) return "기종명을 입력하세요.";
      if (!form.partName.trim()) return "부품명을 입력하세요.";
    } else {
      // 아산 등: 제품 품번 필수 (ERP 조회)
      if (!form.itemCode) return "품목 코드를 선택하세요.";
    }
    if (!form.processCd) return "공정을 선택하세요.";
    if (!form.flawTypeCd) return "불량 유형을 선택하세요.";
    if (!form.actionDirection) return "조치 방향을 선택하세요.";
    if (!form.description.trim()) return "설명을 입력하세요.";
    return null;
  };

  const handleSubmit = async () => {
    const err = validate();
    if (err) {
      Alert.alert("입력 오류", err);
      return;
    }
    try {
      setUploading(true);
      let imageUrl: string | null = null;
      if (form.imageUri) {
        imageUrl = await uploadImage(form.imageUri);
      }

      // 화성 폴백: itemCode 가 비면 modelName, 그것도 없으면 "미정" (QC 승인 시 가드가 차단).
      // description 앞에 "[부품: X] " prepend 로 QC 목록에서 즉시 어느 부품인지 보이게.
      const effectiveItemCode = form.itemCode.trim()
        || (isHwaseong ? form.modelName.trim() : "")
        || "미정";
      const effectiveDescription = isHwaseong && form.partName.trim()
        ? `[부품: ${form.partName.trim()}] ${form.description.trim()}`
        : form.description.trim();

      await createReport.mutateAsync({
        data: {
          reportDate: new Date().toISOString(),
          itemCode: effectiveItemCode,
          modelName: form.modelName.trim() || null,
          partCode: form.partCode.trim() || null,
          processName: form.processName,
          defectType: form.defectType,
          description: effectiveDescription,
          imageUrl,
          plantCd: form.plantCd,
          processCd: form.processCd,
          flawTypeCd: form.flawTypeCd,
          defectQty: form.defectQty ? parseInt(form.defectQty, 10) : null,
          registrantName: user?.username ?? null,
          actionDirection: form.actionDirection as ActionDirection,
        },
      });

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSubmitted(true);
      setUploading(false);
      setTimeout(() => {
        setForm(INITIAL_FORM);
        setSubmitted(false);
        scrollRef.current?.scrollTo({ y: 0, animated: true });
      }, 2000);
    } catch {
      setUploading(false);
      Alert.alert("오류", "보고서 제출에 실패했습니다. 다시 시도하세요.");
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const s = makeStyles(colors, topPad);

  if (submitted) {
    return (
      <View style={[s.successScreen, { backgroundColor: colors.background }]}>
        <View style={s.successIcon}>
          <Ionicons name="checkmark" size={40} color={colors.primaryForeground} />
        </View>
        <Text style={s.successTitle}>제출 완료</Text>
        <Text style={s.successSub}>보고서가 성공적으로 등록되었습니다.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      ref={scrollRef}
      style={[s.root, { backgroundColor: colors.background }]}
      contentContainerStyle={s.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={s.pageHeader}>
        <Text style={s.pageTitle}>부적합 보고서 등록</Text>
        <Text style={s.pageSubtitle}>현장에서 발생한 불량을 즉시 등록하세요</Text>
      </View>

      {/* 품목 섹션 — 공장별 분기 (2026-11 화성 업무개선 미팅 반영) */}
      {isHwaseong ? (
        <>
          <View style={s.section}>
            <Text style={s.sectionLabel}>기종명 *</Text>
            <TextInput
              style={s.selectBox}
              value={form.modelName}
              onChangeText={(v) => setForm((f) => ({ ...f, modelName: v }))}
              placeholder="예: SB-100, JD-1400E, 실린더바디"
              placeholderTextColor={colors.mutedForeground}
              testID="hw-model-name"
            />
          </View>
          <View style={s.section}>
            <Text style={s.sectionLabel}>부품명 *</Text>
            <TextInput
              style={s.selectBox}
              value={form.partName}
              onChangeText={(v) => setForm((f) => ({ ...f, partName: v }))}
              placeholder="예: 로드핀, 실린더 커버, 플레이트"
              placeholderTextColor={colors.mutedForeground}
              testID="hw-part-name"
            />
          </View>
          <View style={s.section}>
            <Text style={s.sectionLabel}>부품코드 (선택)</Text>
            <TextInput
              style={s.selectBox}
              value={form.partCode}
              onChangeText={(v) => setForm((f) => ({ ...f, partCode: v }))}
              placeholder="알면 입력, 모르면 비워두면 QC 가 보완"
              placeholderTextColor={colors.mutedForeground}
              testID="hw-part-code"
            />
          </View>
        </>
      ) : (
        <View style={s.section}>
          <Text style={s.sectionLabel}>품목 코드 *</Text>
          <Pressable
            style={s.selectBox}
            onPress={() => setItemSearchOpen((v) => !v)}
            testID="item-code-picker"
          >
            <Text
              style={form.itemCode ? s.selectText : s.selectPlaceholder}
            >
              {form.itemCode || "품목 코드 검색"}
            </Text>
            <Ionicons
              name={itemSearchOpen ? "chevron-up" : "chevron-down"}
              size={18}
              color={colors.mutedForeground}
            />
          </Pressable>
          {itemSearchOpen && (
            <View style={s.searchDropdown}>
              <TextInput
                style={s.searchInput}
                value={form.itemSearch}
                onChangeText={(v) => setForm((f) => ({ ...f, itemSearch: v }))}
                placeholder="품목명 또는 코드 입력"
                placeholderTextColor={colors.mutedForeground}
                autoFocus
                testID="item-search-input"
              />
              {items && items.length > 0 ? (
                items.map((item) => (
                  <Pressable
                    key={item.id}
                    style={s.dropdownItem}
                    onPress={() => {
                      setForm((f) => ({
                        ...f,
                        itemCode: item.code,
                        itemSearch: item.code,
                      }));
                      setItemSearchOpen(false);
                    }}
                  >
                    <Text style={s.dropdownItemCode}>{item.code}</Text>
                    <Text style={s.dropdownItemName}>{item.name}</Text>
                  </Pressable>
                ))
              ) : form.itemSearch.length >= 2 ? (
                <Text style={s.emptyDropdown}>검색 결과 없음</Text>
              ) : (
                <Text style={s.emptyDropdown}>2자 이상 입력하세요</Text>
              )}
            </View>
          )}
        </View>
      )}

      <View style={s.row}>
        <View style={[s.section, { flex: 1 }]}>
          <Text style={s.sectionLabel}>공장 *</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={s.chipRow}>
              {plants?.map((p) => (
                <Pressable
                  key={p.plantCd}
                  style={[
                    s.chip,
                    form.plantCd === p.plantCd && s.chipActive,
                  ]}
                  onPress={() =>
                    setForm((f) => ({
                      ...f,
                      plantCd: p.plantCd,
                      processCd: "",
                      processName: "",
                    }))
                  }
                >
                  <Text
                    style={[
                      s.chipText,
                      form.plantCd === p.plantCd && s.chipTextActive,
                    ]}
                  >
                    {p.plantNm}
                  </Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        </View>
      </View>

      {form.plantCd && (
        <View style={s.section}>
          <Text style={s.sectionLabel}>공정 *</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={s.chipRow}>
              {processes?.map((p) => (
                <Pressable
                  key={p.processCd}
                  style={[
                    s.chip,
                    form.processCd === p.processCd && s.chipActive,
                  ]}
                  onPress={() =>
                    setForm((f) => ({
                      ...f,
                      processCd: p.processCd,
                      processName: p.processNm,
                    }))
                  }
                >
                  <Text
                    style={[
                      s.chipText,
                      form.processCd === p.processCd && s.chipTextActive,
                    ]}
                  >
                    {p.processNm}
                  </Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        </View>
      )}

      <View style={s.section}>
        <Text style={s.sectionLabel}>불량 유형 *</Text>
        <View style={s.chipGrid}>
          {flawTypes?.map((ft) => (
            <Pressable
              key={ft.typeCd}
              style={[
                s.chip,
                form.flawTypeCd === ft.typeCd && s.chipActive,
              ]}
              onPress={() =>
                setForm((f) => ({
                  ...f,
                  flawTypeCd: ft.typeCd,
                  defectType: ft.typeNm,
                }))
              }
            >
              <Text
                style={[
                  s.chipText,
                  form.flawTypeCd === ft.typeCd && s.chipTextActive,
                ]}
              >
                {ft.typeNm}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={s.section}>
        <Text style={s.sectionLabel}>조치 방향 *</Text>
        <View style={{ gap: 8 }}>
          {ACTION_DIRECTIONS.map((dir) => (
            <Pressable
              key={dir}
              style={[
                s.chip,
                { width: "100%", justifyContent: "flex-start", paddingHorizontal: 16, paddingVertical: 12 },
                form.actionDirection === dir && s.chipActive,
              ]}
              onPress={() => setForm((f) => ({ ...f, actionDirection: dir }))}
            >
              <Text
                style={[
                  s.chipText,
                  form.actionDirection === dir && s.chipTextActive,
                ]}
              >
                {dir}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={s.section}>
        <Text style={s.sectionLabel}>불량 수량</Text>
        <TextInput
          style={s.input}
          value={form.defectQty}
          onChangeText={(v) => setForm((f) => ({ ...f, defectQty: v }))}
          placeholder="수량 입력 (선택)"
          placeholderTextColor={colors.mutedForeground}
          keyboardType="number-pad"
          testID="defect-qty-input"
        />
      </View>

      <View style={s.section}>
        <Text style={s.sectionLabel}>설명 *</Text>
        <TextInput
          style={[s.input, s.textarea]}
          value={form.description}
          onChangeText={(v) => setForm((f) => ({ ...f, description: v }))}
          placeholder="불량 내용을 자세히 입력하세요"
          placeholderTextColor={colors.mutedForeground}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
          testID="description-input"
        />
      </View>

      <View style={s.section}>
        <Text style={s.sectionLabel}>사진</Text>
        {form.imageUri ? (
          <View style={s.imagePreviewWrap}>
            <Image
              source={{ uri: form.imageUri }}
              style={s.imagePreview}
              resizeMode="cover"
            />
            <Pressable
              style={s.removeImageBtn}
              onPress={() => setForm((f) => ({ ...f, imageUri: null, imageUrl: null }))}
            >
              <Ionicons name="close" size={16} color={colors.primaryForeground} />
            </Pressable>
          </View>
        ) : (
          <View style={s.imageButtons}>
            {Platform.OS !== "web" && (
              <TouchableOpacity style={s.imageBtn} onPress={takePhoto} testID="camera-button">
                <MaterialIcons name="camera-alt" size={22} color={colors.primary} />
                <Text style={s.imageBtnText}>촬영</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={s.imageBtn} onPress={pickImage} testID="gallery-button">
              <Ionicons name="images-outline" size={22} color={colors.primary} />
              <Text style={s.imageBtnText}>갤러리</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <Pressable
        style={({ pressed }) => [
          s.submitBtn,
          { opacity: pressed || uploading || createReport.isPending ? 0.75 : 1 },
        ]}
        onPress={handleSubmit}
        disabled={uploading || createReport.isPending}
        testID="submit-button"
      >
        {uploading || createReport.isPending ? (
          <ActivityIndicator color={colors.primaryForeground} />
        ) : (
          <>
            <Ionicons name="send" size={18} color={colors.primaryForeground} />
            <Text style={s.submitBtnText}>보고서 제출</Text>
          </>
        )}
      </Pressable>
    </ScrollView>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>, topPad: number) {
  return StyleSheet.create({
    root: {
      flex: 1,
    },
    content: {
      paddingTop: topPad + 16,
      paddingHorizontal: 20,
      paddingBottom: 120,
      gap: 4,
    },
    pageHeader: {
      marginBottom: 20,
    },
    pageTitle: {
      fontSize: 24,
      fontFamily: "Inter_700Bold",
      color: colors.foreground,
      marginBottom: 4,
    },
    pageSubtitle: {
      fontSize: 14,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
    },
    section: {
      marginBottom: 16,
    },
    row: {
      flexDirection: "row",
      gap: 12,
    },
    sectionLabel: {
      fontSize: 13,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
      marginBottom: 8,
    },
    selectBox: {
      height: 48,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      paddingHorizontal: 14,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    selectText: {
      fontSize: 15,
      fontFamily: "Inter_400Regular",
      color: colors.foreground,
    },
    selectPlaceholder: {
      fontSize: 15,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
    },
    searchDropdown: {
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      marginTop: 4,
      overflow: "hidden",
    },
    searchInput: {
      height: 44,
      paddingHorizontal: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      fontSize: 14,
      fontFamily: "Inter_400Regular",
      color: colors.foreground,
    },
    dropdownItem: {
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    dropdownItemCode: {
      fontSize: 13,
      fontFamily: "Inter_600SemiBold",
      color: colors.primary,
      minWidth: 80,
    },
    dropdownItemName: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.foreground,
      flex: 1,
    },
    emptyDropdown: {
      padding: 14,
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      textAlign: "center",
    },
    chipRow: {
      flexDirection: "row",
      flexWrap: "nowrap",
      gap: 8,
    },
    chipGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    chip: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    chipActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    chipText: {
      fontSize: 13,
      fontFamily: "Inter_500Medium",
      color: colors.foreground,
    },
    chipTextActive: {
      color: colors.primaryForeground,
    },
    input: {
      height: 48,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      paddingHorizontal: 14,
      fontSize: 15,
      fontFamily: "Inter_400Regular",
      color: colors.foreground,
    },
    textarea: {
      height: 100,
      paddingTop: 12,
    },
    imagePreviewWrap: {
      position: "relative",
      borderRadius: colors.radius,
      overflow: "hidden",
      height: 180,
    },
    imagePreview: {
      width: "100%",
      height: "100%",
    },
    removeImageBtn: {
      position: "absolute",
      top: 8,
      right: 8,
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: colors.foreground,
      alignItems: "center",
      justifyContent: "center",
    },
    imageButtons: {
      flexDirection: "row",
      gap: 10,
    },
    imageBtn: {
      flex: 1,
      height: 52,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
    },
    imageBtnText: {
      fontSize: 14,
      fontFamily: "Inter_500Medium",
      color: colors.primary,
    },
    submitBtn: {
      height: 54,
      borderRadius: colors.radius,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 10,
      marginTop: 8,
    },
    submitBtnText: {
      fontSize: 16,
      fontFamily: "Inter_600SemiBold",
      color: colors.primaryForeground,
    },
    successScreen: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 16,
    },
    successIcon: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    successTitle: {
      fontSize: 24,
      fontFamily: "Inter_700Bold",
      color: colors.foreground,
    },
    successSub: {
      fontSize: 15,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
    },
  });
}
