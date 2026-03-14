#!/usr/bin/env python3
"""
Telegram Channel Send - 改进版
支持模糊匹配频道名称、自动更新频道列表、多图发送
"""
import json
import mimetypes
import os
import sys
import urllib.parse
import urllib.request
from difflib import SequenceMatcher

TOKEN_ENV = "TELEGRAM_BOT_TOKEN"
TOKEN_FALLBACK_PATH = "/path/to/local/config/telegram_bot_token.txt"
KNOWN_CHANNELS_PATH = "/path/to/local/config/telegram_channels.json"

# 频道别名映射：别名 -> 目标频道标识（可以是频道名、用户名或 chat_id）
# 用于将常见称呼映射到具体频道
CHANNEL_ALIASES = {
    # 笔记本频道 - 文字内容
    "笔记本": "笔记本",
    "文字": "笔记本",
    "book": "笔记本",
    "笔记": "笔记本",
    # 林云窝频道 - 公开日记本
    "日记本": "林云窝",
    "公开日记本": "林云窝",
    "日记": "林云窝",
    "林云窝": "林云窝",
    "life": "林云窝",
}


def read_token():
    token = os.environ.get(TOKEN_ENV)
    if token:
        return token.strip()
    if os.path.exists(TOKEN_FALLBACK_PATH):
        with open(TOKEN_FALLBACK_PATH, "r", encoding="utf-8") as f:
            return f.read().strip()
    return None


def api_call(token, method, params=None):
    base = f"https://api.telegram.org/bot{token}/{method}"
    if params:
        data = urllib.parse.urlencode(params).encode("utf-8")
    else:
        data = None
    req = urllib.request.Request(base, data=data)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def api_call_multipart(token, method, fields, files):
    """
    发送 multipart/form-data 请求（用于上传图片）
    fields: dict of str
    files: list of (field_name, filename, data, content_type)
    """
    boundary = f"----TGFormBoundary{os.getpid()}"
    CRLF = b"\r\n"
    body_parts = []
    for key, val in fields.items():
        body_parts.append(f"--{boundary}".encode())
        body_parts.append(f"Content-Disposition: form-data; name=\"{key}\"".encode())
        body_parts.append(b"")
        body_parts.append(val.encode("utf-8") if isinstance(val, str) else val)
    for field_name, filename, data, content_type in files:
        body_parts.append(f"--{boundary}".encode())
        body_parts.append(
            f"Content-Disposition: form-data; name=\"{field_name}\"; filename=\"{filename}\"".encode()
        )
        body_parts.append(f"Content-Type: {content_type}".encode())
        body_parts.append(b"")
        body_parts.append(data)
    body_parts.append(f"--{boundary}--".encode())
    body = CRLF.join(body_parts)

    url = f"https://api.telegram.org/bot{token}/{method}"
    req = urllib.request.Request(
        url, data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"}
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def upload_photo(token, chat_id, photo_path, caption=None):
    """
    上传单张图片并发送到频道（sendPhoto），返回响应 JSON
    """
    with open(photo_path, "rb") as f:
        data = f.read()
    filename = os.path.basename(photo_path)
    mime_type = mimetypes.guess_type(filename)[0] or "image/jpeg"
    fields = {"chat_id": str(chat_id)}
    if caption:
        fields["caption"] = caption
    files = [("photo", filename, data, mime_type)]
    return api_call_multipart(token, "sendPhoto", fields, files)


def send_media_group(token, chat_id, image_paths, caption=None):
    """
    使用 sendMediaGroup 发送多张图片（最多 10 张）
    caption 作为第一张图片的 caption 显示
    """
    CRLF = b"\r\n"
    boundary = f"----TGMediaBoundary{os.getpid()}"
    body_parts = []
    media_list = []

    # 构造 media JSON 元数据
    for i, img_path in enumerate(image_paths[:10]):
        attach_name = f"photo{i}"
        item = {"type": "photo", "media": f"attach://{attach_name}"}
        if i == 0 and caption:
            item["caption"] = caption
        media_list.append(item)

    # 添加 chat_id 字段
    body_parts.append(f"--{boundary}".encode())
    body_parts.append(b"Content-Disposition: form-data; name=\"chat_id\"")
    body_parts.append(b"")
    body_parts.append(str(chat_id).encode())

    # 添加 media 字段
    body_parts.append(f"--{boundary}".encode())
    body_parts.append(b"Content-Disposition: form-data; name=\"media\"")
    body_parts.append(b"Content-Type: application/json")
    body_parts.append(b"")
    body_parts.append(json.dumps(media_list, ensure_ascii=False).encode("utf-8"))

    # 添加每张图片文件
    for i, img_path in enumerate(image_paths[:10]):
        attach_name = f"photo{i}"
        filename = os.path.basename(img_path)
        mime_type = mimetypes.guess_type(filename)[0] or "image/jpeg"
        with open(img_path, "rb") as f:
            img_data = f.read()
        body_parts.append(f"--{boundary}".encode())
        body_parts.append(
            f"Content-Disposition: form-data; name=\"{attach_name}\"; filename=\"{filename}\"".encode()
        )
        body_parts.append(f"Content-Type: {mime_type}".encode())
        body_parts.append(b"")
        body_parts.append(img_data)

    body_parts.append(f"--{boundary}--".encode())
    body = CRLF.join(body_parts)

    url = f"https://api.telegram.org/bot{token}/sendMediaGroup"
    req = urllib.request.Request(
        url, data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"}
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def get_bot_id(token):
    resp = api_call(token, "getMe")
    if not resp.get("ok"):
        raise RuntimeError(resp)
    return resp.get("result", {}).get("id")


def collect_channels_from_updates(token):
    """从最近的更新中收集频道信息"""
    params = {
        "limit": 100,
        "allowed_updates": json.dumps(["channel_post", "my_chat_member"]),
    }
    resp = api_call(token, "getUpdates", params=params)
    if not resp.get("ok"):
        raise RuntimeError(resp)

    channels = {}
    for upd in resp.get("result", []):
        msg = upd.get("channel_post")
        if msg and msg.get("chat", {}).get("type") == "channel":
            chat = msg["chat"]
            channels[chat["id"]] = {
                "id": chat["id"],
                "title": chat.get("title") or "(no title)",
                "username": chat.get("username"),
            }
        mcm = upd.get("my_chat_member")
        if mcm and mcm.get("chat", {}).get("type") == "channel":
            chat = mcm["chat"]
            channels[chat["id"]] = {
                "id": chat["id"],
                "title": chat.get("title") or "(no title)",
                "username": chat.get("username"),
            }
    return list(channels.values())


def load_known_channels():
    """从本地文件加载已知的频道列表"""
    if not os.path.exists(KNOWN_CHANNELS_PATH):
        return []
    with open(KNOWN_CHANNELS_PATH, "r", encoding="utf-8") as f:
        try:
            return json.load(f)
        except Exception:
            return []


def save_known_channels(channels):
    """保存频道列表到本地文件"""
    os.makedirs(os.path.dirname(KNOWN_CHANNELS_PATH), exist_ok=True)
    with open(KNOWN_CHANNELS_PATH, "w", encoding="utf-8") as f:
        json.dump(channels, f, ensure_ascii=False, indent=2)


def normalize_chat_ref(ref):
    """标准化频道引用"""
    ref = ref.strip()
    if not ref:
        return None
    if ref.startswith("@"):  # username
        return ref.lower()
    if ref.isdigit() or (ref.startswith("-100") and ref[4:].isdigit()):
        return int(ref)
    return ref  # 字符串名称


def resolve_chat(token, ref):
    """通过 API 解析频道信息"""
    try:
        resp = api_call(token, "getChat", params={"chat_id": ref})
        if not resp.get("ok"):
            return None
        chat = resp.get("result", {})
        if chat.get("type") != "channel":
            return None
        return {
            "id": chat.get("id"),
            "title": chat.get("title") or "(no title)",
            "username": chat.get("username"),
        }
    except Exception:
        return None


def can_post_to_channel(token, chat_id, bot_id):
    """检查机器人是否有权限在频道发送消息"""
    try:
        resp = api_call(token, "getChatMember", params={"chat_id": chat_id, "user_id": bot_id})
        if not resp.get("ok"):
            return False, resp
        cm = resp.get("result", {})
        status = cm.get("status")
        if status == "creator":
            return True, resp
        if status == "administrator":
            can_post = cm.get("can_post_messages")
            return True if can_post is None else bool(can_post), resp
        return False, resp
    except Exception as e:
        return False, str(e)


def similarity_score(a, b):
    """计算两个字符串的相似度分数 (0-1)"""
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


def resolve_alias(query):
    """
    解析频道别名
    返回: (解析后的查询词, 是否匹配到别名)
    """
    query_lower = query.strip().lower()
    for alias, target in CHANNEL_ALIASES.items():
        if query_lower == alias.lower():
            return target, True
    return query, False


def find_channel_fuzzy(channels, query):
    """
    模糊搜索频道
    返回: (最佳匹配频道, 所有匹配列表)
    """
    query = query.strip()

    # 先尝试解析别名
    resolved_query, is_alias = resolve_alias(query)
    if is_alias:
        query = resolved_query
        print(f"  Alias resolved: '{query.strip().lower()}' -> '{resolved_query}'", file=sys.stderr)

    query_lower = query.lower()
    matches = []

    for ch in channels:
        title = ch.get("title", "")
        username = ch.get("username", "")

        # 完全匹配
        if title.lower() == query_lower:
            matches.append((ch, 1.0, "exact_title"))
            continue
        if username and username.lower() == query_lower.lstrip("@"):
            matches.append((ch, 1.0, "exact_username"))
            continue

        # 包含匹配
        if query_lower in title.lower():
            score = 0.8 + (len(query) / len(title)) * 0.2
            matches.append((ch, score, "contains_title"))
            continue

        # 相似度匹配
        title_sim = similarity_score(query, title)
        if title_sim > 0.5:
            matches.append((ch, title_sim, "similar_title"))
            continue

        # 用户名匹配
        if username and query_lower in username.lower():
            matches.append((ch, 0.7, "contains_username"))
            continue

    # 按分数排序
    matches.sort(key=lambda x: x[1], reverse=True)

    if not matches:
        return None, []

    # 如果有多个高分匹配（分数差小于0.1），返回列表让用户选择
    best = matches[0]
    close_matches = [m for m in matches if m[1] > 0.5 and abs(m[1] - best[1]) < 0.15]

    return best[0], close_matches


def refresh_and_merge_channels(token):
    """
    刷新频道列表：从 API 获取最新，合并本地缓存
    返回: (合并后的频道列表, 是否有更新)
    """
    known = load_known_channels()
    known_map = {ch["id"]: ch for ch in known if ch.get("id")}

    try:
        fresh = collect_channels_from_updates(token)
        fresh_map = {ch["id"]: ch for ch in fresh}

        # 合并：新的覆盖旧的，但保留旧的中不在新列表里的
        merged = dict(known_map)
        merged.update(fresh_map)

        # 尝试验证并更新已知频道的信息
        updated = False
        for ch_id in list(merged.keys()):
            ch = merged[ch_id]
            # 如果有用户名，尝试刷新信息
            if ch.get("username"):
                fresh_info = resolve_chat(token, f"@{ch['username']}")
                if fresh_info:
                    merged[ch_id] = fresh_info
                    updated = True

        channels = list(merged.values())
        save_known_channels(channels)
        return channels, True

    except Exception as e:
        print(f"Warning: Failed to refresh from API: {e}", file=sys.stderr)
        # 返回已知的频道
        return list(known_map.values()), False


def guess_channel_identifier(user_input):
    """
    猜测用户输入的频道标识类型
    返回: (类型, 标准化后的值)
    类型: 'chat_id', 'username', 'name'
    """
    ref = normalize_chat_ref(user_input)

    if isinstance(ref, int):
        return "chat_id", ref

    if isinstance(ref, str) and ref.startswith("@"):
        return "username", ref

    return "name", user_input


def get_allowed_channels(token, bot_id, channels):
    """过滤出有发送权限的频道"""
    allowed = []
    for ch in channels:
        ok, _ = can_post_to_channel(token, ch["id"], bot_id)
        if ok:
            allowed.append(ch)
    return allowed


def output_channel_choice(options, query=None):
    """输出频道选择请求，供上层处理"""
    result = {
        "action": "choose",
        "query": query,
        "options": [
            {
                "id": ch["id"],
                "title": ch["title"],
                "username": ch.get("username"),
                "score": score if isinstance(score, (int, float)) else 0
            }
            for ch, score, _ in options
        ]
    }
    print(json.dumps(result, ensure_ascii=False))
    return 2  # 特殊返回码：需要用户选择


def main():
    token = read_token()
    if not token:
        print("Missing bot token. Set TELEGRAM_BOT_TOKEN or create /path/to/local/config/telegram_bot_token.txt", file=sys.stderr)
        return 1

    try:
        bot_id = get_bot_id(token)
    except Exception as e:
        print(f"Failed to get bot id: {e}", file=sys.stderr)
        return 1

    # 解析命令行参数：支持 --images path1 path2 ...
    raw_args = sys.argv[1:]
    channel_arg = None
    message_arg = None
    image_paths = []

    # 提取 --images 参数（其后的所有参数都为图片路径）
    if "--images" in raw_args:
        idx = raw_args.index("--images")
        image_paths = raw_args[idx + 1:]
        args = raw_args[:idx]  # --images 前面的参数才是频道/消息
    else:
        args = raw_args

    # 检查图片路径是否实际存在
    valid_images = [p for p in image_paths if os.path.isfile(p)]
    if len(valid_images) < len(image_paths):
        missing = [p for p in image_paths if not os.path.isfile(p)]
        print(f"Warning: {len(missing)} 图片路径不存在: {missing}", file=sys.stderr)
    image_paths = valid_images

    # 检查是否是特殊模式
    if len(args) == 1 and args[0] == "--list-channels":
        # 只列出频道，不发送
        print("Refreshing channel list...", file=sys.stderr)
        channels, _ = refresh_and_merge_channels(token)
        allowed = get_allowed_channels(token, bot_id, channels)
        print(json.dumps({
            "action": "list",
            "channels": allowed
        }, ensure_ascii=False))
        return 0

    has_stdin = not sys.stdin.isatty()

    if len(args) >= 2:
        channel_arg = args[0]
        message_arg = args[1]
    elif len(args) == 1:
        # 如果存在来自 stdin 的数据（如 Node 端传入正文），则唯一参数被视为频道名
        if has_stdin:
            channel_arg = args[0]
            message_arg = None
        else:
            # 只有一个参数又没有 stdin 输入：可能是消息（需要询问频道）或频道名（缺少消息）
            # 优先当作消息处理，触发频道选择
            message_arg = args[0]

    # 步骤 1: 自动刷新频道列表
    print("Refreshing channel list...", file=sys.stderr)
    channels, refreshed = refresh_and_merge_channels(token)
    print(f"  Loaded {len(channels)} channels", file=sys.stderr)

    # 获取有权限的频道列表
    allowed = get_allowed_channels(token, bot_id, channels)
    if not allowed:
        print("No channels where the bot can post.", file=sys.stderr)
        return 1

    print(f"  {len(allowed)} channels with post permission", file=sys.stderr)

    # 步骤 2: 确定目标频道
    chosen = None
    need_choice = False
    choice_options = []

    if channel_arg:
        id_type, id_value = guess_channel_identifier(channel_arg)

        # 情况 1: 用户提供了 chat_id
        if id_type == "chat_id":
            for ch in allowed:
                if ch["id"] == id_value:
                    chosen = ch
                    break
            if not chosen:
                # 尝试 API 解析
                ch = resolve_chat(token, id_value)
                if ch:
                    ok, _ = can_post_to_channel(token, ch["id"], bot_id)
                    if ok:
                        chosen = ch
                        channels.append(ch)
                        save_known_channels(channels)

        # 情况 2: 用户提供了 @username
        elif id_type == "username":
            username = id_value.lstrip("@").lower()
            for ch in allowed:
                ch_username = (ch.get("username") or "").lower()
                if ch_username == username:
                    chosen = ch
                    break
            if not chosen:
                ch = resolve_chat(token, id_value)
                if ch:
                    ok, _ = can_post_to_channel(token, ch["id"], bot_id)
                    if ok:
                        chosen = ch
                        channels.append(ch)
                        save_known_channels(channels)

        # 情况 3: 用户提供了名称（模糊匹配）
        else:
            best_match, candidates = find_channel_fuzzy(allowed, channel_arg)
            if best_match:
                # 检查是否有多个相近匹配
                if len(candidates) >= 2 and abs(candidates[0][1] - candidates[1][1]) < 0.15:
                    # 多个相近匹配，需要用户选择
                    need_choice = True
                    choice_options = candidates
                else:
                    # 只有一个最佳匹配，或者明显优于其他
                    chosen = best_match
                    print(f"  Matched channel: {chosen['title']}", file=sys.stderr)
            else:
                # 没有匹配到，需要用户从所有频道中选择
                need_choice = True
                # 给所有频道一个默认分数
                choice_options = [(ch, 0, "all") for ch in allowed]

    else:
        # 没有提供频道参数，需要用户选择
        need_choice = True
        # 按标题排序，方便选择
        sorted_allowed = sorted(allowed, key=lambda x: x.get("title", ""))
        choice_options = [(ch, 0, "all") for ch in sorted_allowed]

    # 如果需要选择，输出选择请求
    if need_choice:
        return output_channel_choice(choice_options, channel_arg)

    # 步骤 4: 获取消息内容
    if message_arg:
        text = message_arg
    else:
        text = sys.stdin.read()

    if not text or not text.strip():
        print("Empty message.", file=sys.stderr)
        return 1

    # 步骤 5: 发送消息（根据是否有图片选择不同方式）
    chat_id = chosen["id"]
    print(f"\nSending to: {chosen['title']} ({chat_id})", file=sys.stderr)

    try:
        if image_paths:
            # 有图片：使用 sendMediaGroup 发送图片组，文字作为第一张的 caption
            print(f"  发送图片组: {len(image_paths)} 张图片", file=sys.stderr)
            caption = text if text and text.strip() else None

            if len(image_paths) == 1:
                # 单张图片用 sendPhoto，可以配 caption
                resp = upload_photo(token, chat_id, image_paths[0], caption=caption)
            else:
                # 多张图片用 sendMediaGroup
                resp = send_media_group(token, chat_id, image_paths, caption=caption)

            if resp.get("ok"):
                results = resp.get("result", [])
                # sendMediaGroup 返回一个数组，sendPhoto 返回对象
                if isinstance(results, list):
                    msg_id = results[0].get("message_id") if results else None
                    chat_info = results[0].get("chat", {}) if results else {}
                else:
                    msg_id = results.get("message_id")
                    chat_info = results.get("chat", {})
                print(json.dumps({
                    "ok": True,
                    "message_id": msg_id,
                    "image_count": len(image_paths),
                    "channel": {
                        "id": chat_info.get("id"),
                        "title": chat_info.get("title"),
                        "username": chat_info.get("username")
                    }
                }, ensure_ascii=False))
                return 0
            else:
                print(f"Failed to send media group: {resp}", file=sys.stderr)
                return 1
        else:
            # 无图片：走原有 sendMessage 路径
            resp = api_call(token, "sendMessage", params={"chat_id": chat_id, "text": text})
            if resp.get("ok"):
                result = resp.get("result", {})
                msg_id = result.get("message_id")
                chat_info = result.get("chat", {})
                print(json.dumps({
                    "ok": True,
                    "message_id": msg_id,
                    "channel": {
                        "id": chat_info.get("id"),
                        "title": chat_info.get("title"),
                        "username": chat_info.get("username")
                    }
                }, ensure_ascii=False))
                return 0
            else:
                print(f"Failed: {resp}", file=sys.stderr)
                return 1
    except Exception as e:
        print(f"Failed to send message: {e}", file=sys.stderr)
        print(f"Channel: {chat_id}", file=sys.stderr)
        print("Make sure the bot is an admin in the channel with post permissions.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
