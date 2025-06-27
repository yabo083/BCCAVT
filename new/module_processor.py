import re, os
import pandas as pd
import json


# 读取CSV文件
def read_csv(file_path):
    df = pd.read_csv(file_path, encoding="utf-8")

    # 将数据转换为字典列表
    comments = df.to_dict(orient="records")

    # 构建评论树
    comment_dict = {comment["评论ID"]: comment for comment in comments}
    comment_trees = []
    independent_comments = []

    # 先给所有评论初始化 replies
    for comment in comments:
        comment["replies"] = []

    for comment in comments:
        parent_id = comment["父评论ID"]
        if parent_id == 0:
            independent_comments.append(comment)
        else:
            if parent_id in comment_dict:
                comment_dict[parent_id]["replies"].append(comment)

    # 将独立评论及其回复组成树结构
    for comment in independent_comments:
        comment_trees.append(comment)


    pattern = r"^(.*?)_comments_(\d{8}_\d{6})\.csv$"
    filename = os.path.basename(file_path)
    match = re.match(pattern, filename)

    if match:
        title = match.group(1)
        # 清理非法文件名字符（包括斜杠和反斜杠）
        title = re.sub(r'[\\/:"*?<>|]', "_", title)
    else:
        raise ValueError(f"文件名 {file_path} 不符合预期格式")

    # 保存为JSON文件供前端使用
    # 创建输出目录
    output_dir = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "bilibili_json_output"
    )
    print(f"输出目录: {output_dir}")
    os.makedirs(output_dir, exist_ok=True)
    output_path = os.path.join(output_dir, f"{title}_comments.json")
    print(f"输出文件: {output_path}")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(comment_trees, f, ensure_ascii=False, indent=2)

    # 基本统计
    print(f"总评论数: {len(comments)}")
    print(f"独立评论数: {len(independent_comments)}")
    print(
        f"最活跃用户: {df['用户名'].value_counts().idxmax()} (出现 {df['用户名'].value_counts().max()} 次)"
    )
    print(
        f"最高点赞评论: {df.loc[df['点赞数'].idxmax()]['评论内容'][:50]}... ({df['点赞数'].max()} 赞)"
    )


if __name__ == "__main__":
    csv_path = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "bilibili_csv_output",
        "【梗百科】别笑 你试也过不了第二关是啥梗？_comments_20250626_162217.csv"
    )
    print(f"读取CSV文件: {csv_path}")
    read_csv(csv_path)
