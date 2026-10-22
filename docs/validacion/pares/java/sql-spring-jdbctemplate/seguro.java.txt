import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

@RestController
public class ProductoController {
    private final JdbcTemplate jdbcTemplate;

    public ProductoController(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @GetMapping("/productos")
    public List<Map<String, Object>> buscar(@RequestParam String categoria) {
        String sql = "SELECT * FROM productos WHERE categoria = ?";
        return jdbcTemplate.queryForList(sql, categoria);
    }
}
