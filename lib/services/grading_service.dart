// ============================================================
// 宿題 自動採点サービス
// Google Apps Script（gas/Code.gs）の Web API と通信する
//
// 接続先は web/grading_config.json で設定します（アプリの作り直し不要）。
//   { "gasUrl": "https://script.google.com/macros/s/xxxx/exec", "appToken": "..." }
// ============================================================
import 'dart:convert';
import 'dart:typed_data';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class GradeItem {
  String number;
  String studentAnswer;
  String correctAnswer;
  bool correct;
  String comment;

  GradeItem({
    required this.number,
    required this.studentAnswer,
    required this.correctAnswer,
    required this.correct,
    required this.comment,
  });

  factory GradeItem.fromJson(Map<String, dynamic> j) => GradeItem(
        number: '${j['number'] ?? ''}',
        studentAnswer: '${j['studentAnswer'] ?? ''}',
        correctAnswer: '${j['correctAnswer'] ?? ''}',
        correct: j['correct'] == true,
        comment: '${j['comment'] ?? ''}',
      );

  Map<String, dynamic> toJson() => {
        'number': number,
        'studentAnswer': studentAnswer,
        'correctAnswer': correctAnswer,
        'correct': correct,
        'comment': comment,
      };
}

class HomeworkSubmission {
  final String id;
  final DateTime? submittedAt;
  final String studentId;
  final String studentName;
  final String workbook;
  final String pages;
  final int photoCount;
  final String status;
  final DateTime? returnedAt;
  final int? score;
  final int? total;
  final List<GradeItem> items;
  final String overallComment;
  final String teacherComment;
  final String error;

  HomeworkSubmission({
    required this.id,
    required this.submittedAt,
    required this.studentId,
    required this.studentName,
    required this.workbook,
    required this.pages,
    required this.photoCount,
    required this.status,
    required this.returnedAt,
    required this.score,
    required this.total,
    required this.items,
    required this.overallComment,
    required this.teacherComment,
    required this.error,
  });

  static const statusGrading = '採点中';
  static const statusGraded = '採点済み';
  static const statusError = '採点エラー';
  static const statusReturned = '返却済み';

  bool get isReturned => status == statusReturned;
  bool get isGraded => status == statusGraded;
  bool get isError => status == statusError;

  factory HomeworkSubmission.fromJson(Map<String, dynamic> j) => HomeworkSubmission(
        id: '${j['id']}',
        submittedAt: DateTime.tryParse('${j['submittedAt'] ?? ''}')?.toLocal(),
        studentId: '${j['studentId'] ?? ''}',
        studentName: '${j['studentName'] ?? ''}',
        workbook: '${j['workbook'] ?? ''}',
        pages: '${j['pages'] ?? ''}',
        photoCount: (j['photoCount'] as num?)?.toInt() ?? 0,
        status: '${j['status'] ?? ''}',
        returnedAt: DateTime.tryParse('${j['returnedAt'] ?? ''}')?.toLocal(),
        score: (j['score'] as num?)?.toInt(),
        total: (j['total'] as num?)?.toInt(),
        items: ((j['items'] as List?) ?? [])
            .map((e) => GradeItem.fromJson(Map<String, dynamic>.from(e as Map)))
            .toList(),
        overallComment: '${j['overallComment'] ?? ''}',
        teacherComment: '${j['teacherComment'] ?? ''}',
        error: '${j['error'] ?? ''}',
      );
}

class GradingException implements Exception {
  final String message;
  GradingException(this.message);
  @override
  String toString() => message;
}

class GradingService {
  GradingService._();
  static final GradingService instance = GradingService._();

  static const _kAdminToken = 'grading_admin_token';
  static const _kSeenReturned = 'grading_seen_returned';

  String? _gasUrl;
  String _appToken = '';
  String? _adminToken;
  bool _loaded = false;

  bool get isConfigured => _gasUrl != null && _gasUrl!.startsWith('https://');
  bool get hasAdminToken => (_adminToken ?? '').isNotEmpty;

  /// grading_config.json と保存済みの先生用合言葉を読み込む
  Future<void> ensureLoaded() async {
    if (_loaded) return;
    try {
      final res = await http.get(Uri.base.resolve('grading_config.json'));
      if (res.statusCode == 200) {
        final j = jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
        final url = '${j['gasUrl'] ?? ''}'.trim();
        _gasUrl = url.startsWith('https://') ? url : null;
        _appToken = '${j['appToken'] ?? ''}';
      }
    } catch (_) {
      // 設定ファイルが無い場合は未設定扱い
    }
    try {
      final prefs = await SharedPreferences.getInstance();
      _adminToken = prefs.getString(_kAdminToken);
    } catch (_) {}
    _loaded = true;
  }

  Future<Map<String, dynamic>> _call(String action, Map<String, dynamic> params,
      {bool admin = false}) async {
    await ensureLoaded();
    if (!isConfigured) {
      throw GradingException('採点サーバーが未設定です（web/grading_config.json に gasUrl を設定してください）');
    }
    final body = <String, dynamic>{
      'action': action,
      'token': _appToken,
      if (admin) 'adminToken': _adminToken ?? '',
      ...params,
    };
    http.Response res;
    try {
      // text/plain にすることでブラウザの事前確認(CORS preflight)を回避する
      res = await http
          .post(Uri.parse(_gasUrl!),
              headers: {'Content-Type': 'text/plain;charset=utf-8'},
              body: jsonEncode(body))
          .timeout(const Duration(minutes: 6));
    } catch (e) {
      throw GradingException('通信に失敗しました。電波の良い場所でもう一度お試しください');
    }
    Map<String, dynamic> j;
    try {
      j = jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
    } catch (_) {
      throw GradingException('採点サーバーから正しい応答がありません（Apps Script のデプロイ設定を確認してください）');
    }
    if (j['ok'] != true) throw GradingException('${j['error'] ?? '不明なエラー'}');
    return j;
  }

  // ---------------- 生徒用 ----------------

  Future<List<String>> listWorkbooks() async {
    final j = await _call('listWorkbooks', {});
    return ((j['workbooks'] as List?) ?? []).map((e) => '$e').toList();
  }

  Future<HomeworkSubmission> submit({
    required String studentId,
    required String studentName,
    required String workbook,
    required String pages,
    required List<Uint8List> jpegImages,
  }) async {
    final j = await _call('submit', {
      'studentId': studentId,
      'studentName': studentName,
      'workbook': workbook,
      'pages': pages,
      'images': jpegImages
          .map((b) => {'mimeType': 'image/jpeg', 'base64': base64Encode(b)})
          .toList(),
    });
    return HomeworkSubmission.fromJson(Map<String, dynamic>.from(j['submission'] as Map));
  }

  Future<List<HomeworkSubmission>> listMine(String studentId) async {
    final j = await _call('listMine', {'studentId': studentId});
    return _parseList(j['submissions']);
  }

  Future<List<Uint8List>> getImages(String id, {String? studentId, bool admin = false}) async {
    final j = await _call('getImages', {'id': id, if (studentId != null) 'studentId': studentId},
        admin: admin);
    return ((j['images'] as List?) ?? [])
        .map((e) => base64Decode('${(e as Map)['base64']}'))
        .toList();
  }

  /// 生徒が既に見た返却済みID（新着バッジ用）
  Future<Set<String>> seenReturnedIds() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      return (prefs.getStringList(_kSeenReturned) ?? []).toSet();
    } catch (_) {
      return {};
    }
  }

  Future<void> markReturnedSeen(String id) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final s = (prefs.getStringList(_kSeenReturned) ?? []).toSet()..add(id);
      await prefs.setStringList(_kSeenReturned, s.toList());
    } catch (_) {}
  }

  // ---------------- 先生用 ----------------

  /// 先生用の合言葉を確認して保存
  Future<void> setAdminToken(String token) async {
    final prev = _adminToken;
    _adminToken = token;
    try {
      await _call('checkAdmin', {}, admin: true);
    } catch (e) {
      _adminToken = prev;
      rethrow;
    }
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_kAdminToken, token);
    } catch (_) {}
  }

  Future<void> clearAdminToken() async {
    _adminToken = null;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(_kAdminToken);
    } catch (_) {}
  }

  Future<List<HomeworkSubmission>> listAll() async {
    final j = await _call('listAll', {}, admin: true);
    return _parseList(j['submissions']);
  }

  Future<HomeworkSubmission> save(String id, List<GradeItem> items, String teacherComment) =>
      _update('update', id, items, teacherComment);

  Future<HomeworkSubmission> returnToStudent(String id, List<GradeItem> items, String teacherComment) =>
      _update('return', id, items, teacherComment);

  Future<HomeworkSubmission> regrade(String id) async {
    final j = await _call('regrade', {'id': id}, admin: true);
    return HomeworkSubmission.fromJson(Map<String, dynamic>.from(j['submission'] as Map));
  }

  Future<void> delete(String id) => _call('delete', {'id': id}, admin: true);

  Future<HomeworkSubmission> _update(
      String action, String id, List<GradeItem> items, String teacherComment) async {
    final j = await _call(action, {
      'id': id,
      'items': items.map((e) => e.toJson()).toList(),
      'teacherComment': teacherComment,
    }, admin: true);
    return HomeworkSubmission.fromJson(Map<String, dynamic>.from(j['submission'] as Map));
  }

  List<HomeworkSubmission> _parseList(dynamic raw) => ((raw as List?) ?? [])
      .map((e) => HomeworkSubmission.fromJson(Map<String, dynamic>.from(e as Map)))
      .toList();
}
