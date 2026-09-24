from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("ember_bridge", "0001_initial")]
    operations = [
        migrations.AddField(
            model_name="workspace",
            name="glossary_state",
            field=models.JSONField(default=dict),
        ),
    ]
